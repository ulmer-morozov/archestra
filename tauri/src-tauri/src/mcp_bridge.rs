use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use uuid::Uuid;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: String,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    pub uri: String,
    pub name: String,
    pub description: Option<String>,
    pub mime_type: Option<String>,
}

// Constants for resource management
const MAX_BUFFER_SIZE: usize = 1000;
const RESPONSE_CLEANUP_INTERVAL: Duration = Duration::from_secs(300); // 5 minutes
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const TOOLS_LIST_TIMEOUT: Duration = Duration::from_secs(5); // Shorter timeout for tools/list
const CHANNEL_CAPACITY: usize = 100;

#[derive(Debug)]
pub struct ResponseEntry {
    pub content: String,
    pub timestamp: Instant,
}

#[derive(Debug)]
pub struct McpServer {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub tools: Vec<McpTool>,
    pub resources: Vec<McpResource>,
    pub stdin_tx: Option<mpsc::Sender<String>>,
    pub response_buffer: Arc<Mutex<VecDeque<ResponseEntry>>>,
    pub process_handle: Option<Arc<TokioMutex<Child>>>,
    pub is_running: bool,
    pub last_health_check: Instant,
}

pub struct McpBridge {
    servers: Arc<Mutex<HashMap<String, McpServer>>>,
}

impl McpBridge {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_mcp_server(&self, name: String, command: String, args: Vec<String>) -> Result<(), String> {
        println!("Starting MCP server '{}' with persistent connection", name);

        // Check if server already exists
        {
            let servers = self.servers.lock().unwrap();
            if let Some(existing) = servers.get(&name) {
                if existing.is_running {
                    return Err(format!("MCP server '{}' is already running", name));
                }
            }
        }

        let mut child = TokioCommand::new("sandbox-exec")
            .arg("-f")
            .arg("./sandbox-exec-profiles/mcp-server-everything-for-now.sb")
            .arg(&command)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server '{}': {}", name, e))?;

        let stdin = child.stdin.take()
            .ok_or_else(|| format!("Failed to get stdin for MCP server '{}'", name))?;
        let stdout = child.stdout.take()
            .ok_or_else(|| format!("Failed to get stdout for MCP server '{}'", name))?;
        let stderr = child.stderr.take()
            .ok_or_else(|| format!("Failed to get stderr for MCP server '{}'", name))?;
        
        // Store process handle
        let process_handle = Arc::new(TokioMutex::new(child));

        // Handle stderr
        let server_name_clone = name.clone();
        tokio::spawn(async move {
            let mut stderr_reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[MCP Server '{}' stderr] {}", server_name_clone, line);
            }
        });

        // Create response buffer with bounded size
        let response_buffer: Arc<Mutex<VecDeque<ResponseEntry>>> = Arc::new(Mutex::new(VecDeque::new()));
        
        // Handle stdout with message parsing and buffer management
        let server_name_clone = name.clone();
        let response_buffer_clone = response_buffer.clone();
        tokio::spawn(async move {
            let mut stdout_reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                println!("[MCP Server '{}' stdout] {}", server_name_clone, line);
                
                // Store response in buffer with timestamp
                {
                    let mut buffer = response_buffer_clone.lock().unwrap();
                    
                    // Clean up old entries
                    let now = Instant::now();
                    buffer.retain(|entry| now.duration_since(entry.timestamp) < RESPONSE_CLEANUP_INTERVAL);
                    
                    // Add new entry, respecting max buffer size
                    if buffer.len() >= MAX_BUFFER_SIZE {
                        buffer.pop_front();
                    }
                    
                    buffer.push_back(ResponseEntry {
                        content: line,
                        timestamp: now,
                    });
                }
            }
            println!("[MCP Server '{}'] stdout reader terminated", server_name_clone);
        });

        // Handle stdin with bounded channel
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(CHANNEL_CAPACITY);
        let server_name_for_stdin = name.clone();
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(message) = stdin_rx.recv().await {
                if let Err(e) = stdin.write_all(message.as_bytes()).await {
                    eprintln!("[MCP Server '{}'] Failed to write to stdin: {}", server_name_for_stdin, e);
                    break;
                }
                if let Err(e) = stdin.flush().await {
                    eprintln!("[MCP Server '{}'] Failed to flush stdin: {}", server_name_for_stdin, e);
                    break;
                }
            }
            println!("[MCP Server '{}'] stdin writer terminated", server_name_for_stdin);
        });

        // Create server struct with all required fields
        let server = McpServer {
            name: name.clone(),
            command,
            args,
            tools: Vec::new(),
            resources: Vec::new(),
            stdin_tx: Some(stdin_tx),
            response_buffer: response_buffer,
            process_handle: Some(process_handle),
            is_running: true,
            last_health_check: Instant::now(),
        };

        // Store server
        {
            let mut servers = self.servers.lock().unwrap();
            servers.insert(name.clone(), server);
        }

        // Initialize the server
        self.initialize_server(&name).await?;

        // Start health monitoring
        self.start_health_monitor(&name).await?;

        println!("MCP server '{}' started successfully", name);
        Ok(())
    }

    async fn initialize_server(&self, server_name: &str) -> Result<(), String> {
        println!("Initializing MCP server '{}'", server_name);

        // Send initialize request
        let init_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: "initialize".to_string(),
            params: Some(serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {}
                },
                "clientInfo": {
                    "name": "archestra-mcp-bridge",
                    "version": "0.1.0"
                }
            })),
        };

        // Wait for initialize response with retries
        match self.send_request_with_retry(server_name, &init_request, 3).await {
            Ok(response) => {
                println!("Initialize response: {:?}", response);
                if let Some(error) = response.error {
                    return Err(format!("Initialize error from server: {} (code: {})", 
                                     error.message, error.code));
                }
            }
            Err(e) => {
                return Err(format!("Failed to initialize MCP server '{}': {}", server_name, e));
            }
        }

        // Send initialized notification (no response expected)
        let initialized_notification = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: "notifications/initialized".to_string(),
            params: None,
        };

        self.send_request(server_name, &initialized_notification).await?;
        
        // Give server time to process initialized notification
        tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

        // Discover tools
        if let Err(e) = self.discover_tools(server_name).await {
            println!("⚠️ Tool discovery failed for '{}': {}", server_name, e);
            // Try to register any known tools for this server type
            self.register_known_tools_if_available(server_name).await;
        } else {
            // Check if we ended up with zero tools for a known server type
            let tool_count = {
                let servers = self.servers.lock().unwrap();
                servers.get(server_name).map(|s| s.tools.len()).unwrap_or(0)
            };
            
            if tool_count == 0 {
                println!("🔄 Tool discovery succeeded but found 0 tools for '{}', trying fallback", server_name);
                self.register_known_tools_if_available(server_name).await;
            }
        }
        
        // Discover resources (optional - some MCP servers may not support this)
        if let Err(e) = self.discover_resources(server_name).await {
            println!("⚠️ Resource discovery failed for '{}': {} (resources are optional)", server_name, e);
        }

        Ok(())
    }

    async fn discover_tools(&self, server_name: &str) -> Result<(), String> {
        println!("Discovering tools for MCP server '{}'", server_name);

        let list_tools_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: "tools/list".to_string(),
            params: None,
        };

        // Send request and wait for response with shorter timeout for tools/list
        match self.send_tools_list_request(server_name, &list_tools_request).await {
            Ok(response) => {
                println!("✅ Received response for tools/list from '{}': {:?}", server_name, response);
                
                if let Some(result) = response.result {
                    println!("🔍 Tools list result from '{}': {:?}", server_name, result);
                    
                    if let Ok(tools_data) = serde_json::from_value::<serde_json::Value>(result.clone()) {
                        if let Some(tools_array) = tools_data.get("tools").and_then(|v| v.as_array()) {
                            println!("🎯 Found {} tools in response from '{}'", tools_array.len(), server_name);
                            let mut tools = Vec::new();
                            for tool_value in tools_array {
                                println!("🔧 Processing tool from '{}': {:?}", server_name, tool_value);
                                match serde_json::from_value::<McpTool>(tool_value.clone()) {
                                    Ok(tool) => {
                                        println!("✅ Successfully parsed tool '{}' from server '{}'", tool.name, server_name);
                                        tools.push(tool);
                                    }
                                    Err(e) => {
                                        println!("⚠️ Failed to parse tool from '{}': {}", server_name, e);
                                        // Try to create a minimal tool from the raw data
                                        if let Some(name) = tool_value.get("name").and_then(|v| v.as_str()) {
                                            println!("🔧 Creating minimal tool '{}' from server '{}'", name, server_name);
                                            tools.push(McpTool {
                                                name: name.to_string(),
                                                description: tool_value.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                                input_schema: tool_value.get("inputSchema").cloned().unwrap_or_else(|| serde_json::json!({})),
                                            });
                                        } else {
                                            println!("❌ Could not extract tool name from: {:?}", tool_value);
                                        }
                                    }
                                }
                            }

                            // Update server with discovered tools
                            {
                                let mut servers = self.servers.lock().unwrap();
                                if let Some(server) = servers.get_mut(server_name) {
                                    server.tools = tools;
                                    println!("🎉 Discovered {} tools for server '{}'. Total tools in bridge: {}", 
                                             server.tools.len(), server_name, 
                                             servers.values().map(|s| s.tools.len()).sum::<usize>());
                                }
                            }
                        } else {
                            println!("⚠️ No 'tools' array found in response from '{}': {:?}", server_name, tools_data);
                            // Check if this is an empty tools response - try fallback
                            if tools_data.get("tools").is_some() && tools_data.get("tools").unwrap().as_array().map_or(false, |arr| arr.is_empty()) {
                                println!("🔄 Server '{}' returned empty tools array, trying fallback registration", server_name);
                                return Err(format!("Empty tools list from server '{}' - triggering fallback", server_name));
                            }
                        }
                    } else {
                        println!("❌ Failed to parse tools response as JSON from '{}': {:?}", server_name, result);
                    }
                } else if let Some(error) = response.error {
                    println!("❌ Error response from '{}': {:?}", server_name, error);
                    return Err(format!("Tools/list error from server '{}': {:?}", server_name, error));
                } else {
                    println!("❌ Empty response from '{}' - no result or error", server_name);
                    return Err(format!("Empty tools/list response from server '{}' - triggering fallback", server_name));
                }
            }
            Err(e) => {
                println!("❌ Failed to get tools list response from '{}': {}", server_name, e);
                // Return error so fallback mechanism can try to register known tools
                return Err(format!("Tools discovery failed for server '{}': {}", server_name, e));
            }
        }

        Ok(())
    }

    async fn register_known_tools_if_available(&self, server_name: &str) {
        // Register known tools for servers that don't support tools/list
        // This is a fallback mechanism for servers with known tool sets
        
        println!("🔄 Attempting to register known tools for server '{}'", server_name);
        
        let known_tools = if server_name.to_lowercase().contains("context7") {
            println!("✅ Found Context7 server, registering known tools");
            // Context7 MCP server tools
            vec![
                McpTool {
                    name: "resolve-library-id".to_string(),
                    description: Some("Resolves a package/product name to a Context7-compatible library ID and returns a list of matching libraries.".to_string()),
                    input_schema: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "libraryName": {
                                "type": "string",
                                "description": "Library name to search for and retrieve a Context7-compatible library ID."
                            }
                        },
                        "required": ["libraryName"]
                    })
                },
                McpTool {
                    name: "get-library-docs".to_string(),
                    description: Some("Fetches up-to-date documentation for a library. You must call 'resolve-library-id' first to obtain the exact Context7-compatible library ID required to use this tool.".to_string()),
                    input_schema: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "context7CompatibleLibraryID": {
                                "type": "string",
                                "description": "Exact Context7-compatible library ID (e.g., '/mongodb/docs', '/vercel/next.js', '/vercel/next.js/v14.3.0-canary.87')"
                            },
                            "tokens": {
                                "type": "number",
                                "description": "Maximum number of tokens of documentation to retrieve (default: 10000)"
                            },
                            "topic": {
                                "type": "string",
                                "description": "Topic to focus documentation on (e.g., 'hooks', 'routing')"
                            }
                        },
                        "required": ["context7CompatibleLibraryID"]
                    })
                }
            ]
        } else {
            // No known tools for this server type
            println!("ℹ️ No known tools registered for server type '{}'", server_name);
            return;
        };

        // Register the known tools
        {
            let mut servers = self.servers.lock().unwrap();
            if let Some(server) = servers.get_mut(server_name) {
                server.tools = known_tools;
                println!("📚 Registered {} known tools for server '{}' (fallback method)", 
                         server.tools.len(), server_name);
            }
        }
    }

    async fn discover_resources(&self, server_name: &str) -> Result<(), String> {
        println!("Discovering resources for MCP server '{}'", server_name);

        let list_resources_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: "resources/list".to_string(),
            params: None,
        };

        // Send request and wait for response with retries
        match self.send_request_with_retry(server_name, &list_resources_request, 2).await {
            Ok(response) => {
                println!("Received response for resources/list: {:?}", response);
                
                if let Some(result) = response.result {
                    if let Ok(resources_data) = serde_json::from_value::<serde_json::Value>(result) {
                        if let Some(resources_array) = resources_data.get("resources").and_then(|v| v.as_array()) {
                            let mut resources = Vec::new();
                            for resource_value in resources_array {
                                match serde_json::from_value::<McpResource>(resource_value.clone()) {
                                    Ok(resource) => {
                                        println!("Successfully parsed resource: {}", resource.uri);
                                        resources.push(resource);
                                    }
                                    Err(e) => {
                                        println!("Failed to parse resource: {}", e);
                                    }
                                }
                            }

                            // Update server with discovered resources
                            {
                                let mut servers = self.servers.lock().unwrap();
                                if let Some(server) = servers.get_mut(server_name) {
                                    server.resources = resources;
                                    println!("Discovered {} resources for server '{}'", server.resources.len(), server_name);
                                }
                            }
                        }
                    }
                } else if let Some(error) = response.error {
                    // Resources might not be supported by this server
                    println!("Resources not supported by server '{}': {:?}", server_name, error);
                }
            }
            Err(e) => {
                // Non-fatal error - resources are optional
                println!("Failed to get resources list (may not be supported): {}", e);
            }
        }

        Ok(())
    }

    async fn send_request(&self, server_name: &str, request: &JsonRpcRequest) -> Result<(), String> {
        let request_json = serde_json::to_string(request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;

        println!("📤 Sending request to '{}': {}", server_name, request_json);

        // Get stdin channel sender
        let stdin_tx = {
            let servers = self.servers.lock().unwrap();
            if let Some(server) = servers.get(server_name) {
                server.stdin_tx.clone()
            } else {
                None
            }
        };

        if let Some(stdin_tx) = stdin_tx {
            let message_with_newline = format!("{}\n", request_json);
            println!("📬 Sending {} bytes to '{}' stdin", message_with_newline.len(), server_name);
            stdin_tx.send(message_with_newline).await
                .map_err(|e| format!("Failed to send to stdin channel: {}", e))?;
            println!("✅ Request sent successfully to '{}'", server_name);
        } else {
            return Err(format!("No stdin channel found for server '{}'", server_name));
        }

        Ok(())
    }

    async fn send_request_with_retry(&self, server_name: &str, request: &JsonRpcRequest, max_retries: u32) -> Result<JsonRpcResponse, String> {
        let mut retries = 0;
        let mut last_error = String::new();
        
        while retries <= max_retries {
            match self.send_request_and_wait(server_name, request).await {
                Ok(response) => return Ok(response),
                Err(e) => {
                    last_error = e;
                    if retries < max_retries {
                        let delay = Duration::from_millis(100 * (2_u64.pow(retries)));
                        println!("Request failed, retrying in {:?}... (attempt {}/{})", delay, retries + 1, max_retries);
                        tokio::time::sleep(delay).await;
                    }
                    retries += 1;
                }
            }
        }
        
        Err(format!("Request failed after {} retries: {}", max_retries, last_error))
    }

    async fn send_tools_list_request(&self, server_name: &str, request: &JsonRpcRequest) -> Result<JsonRpcResponse, String> {
        self.send_request(server_name, request).await?;

        // Get response buffer
        let response_buffer = {
            let servers = self.servers.lock().unwrap();
            if let Some(server) = servers.get(server_name) {
                server.response_buffer.clone()
            } else {
                return Err("Server not found".to_string());
            }
        };

        // Wait for response with shorter timeout for tools/list
        let start_time = Instant::now();
        
        while start_time.elapsed() < TOOLS_LIST_TIMEOUT {
            // Check response buffer
            {
                let mut buffer = response_buffer.lock().unwrap();
                
                // Clean up old entries while we're here
                let now = Instant::now();
                buffer.retain(|entry| now.duration_since(entry.timestamp) < RESPONSE_CLEANUP_INTERVAL);
                
                // Process entries from oldest to newest
                let mut found_response = None;
                for (i, entry) in buffer.iter().enumerate() {
                    // Try to parse as JSON-RPC response
                    if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&entry.content) {
                        if response.id == request.id {
                            found_response = Some((i, response));
                            break;
                        }
                    }
                }
                
                // Remove the found response and return it
                if let Some((index, response)) = found_response {
                    buffer.remove(index);
                    return Ok(response);
                }
            }
            
            // Wait a bit before checking again
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Err(format!("Tools/list request '{}' to server '{}' timed out after {:?}", 
                    request.method, server_name, TOOLS_LIST_TIMEOUT))
    }

    async fn send_request_and_wait(&self, server_name: &str, request: &JsonRpcRequest) -> Result<JsonRpcResponse, String> {
        self.send_request(server_name, request).await?;

        // Get response buffer
        let response_buffer = {
            let servers = self.servers.lock().unwrap();
            if let Some(server) = servers.get(server_name) {
                server.response_buffer.clone()
            } else {
                return Err("Server not found".to_string());
            }
        };

        // Wait for response with timeout
        let start_time = Instant::now();
        
        while start_time.elapsed() < REQUEST_TIMEOUT {
            // Check response buffer
            {
                let mut buffer = response_buffer.lock().unwrap();
                
                // Clean up old entries while we're here
                let now = Instant::now();
                buffer.retain(|entry| now.duration_since(entry.timestamp) < RESPONSE_CLEANUP_INTERVAL);
                
                // Process entries from oldest to newest
                let mut found_response = None;
                for (i, entry) in buffer.iter().enumerate() {
                    // Try to parse as JSON-RPC response
                    if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&entry.content) {
                        if response.id == request.id {
                            found_response = Some((i, response));
                            break;
                        }
                    }
                }
                
                // Remove the found response and return it
                if let Some((index, response)) = found_response {
                    buffer.remove(index);
                    return Ok(response);
                }
            }
            
            // Wait a bit before checking again
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Err(format!("Request '{}' to server '{}' timed out after {:?}", 
                    request.method, server_name, REQUEST_TIMEOUT))
    }

    pub async fn execute_tool(&self, server_name: &str, tool_name: &str, arguments: serde_json::Value) -> Result<serde_json::Value, String> {
        println!("🔧 Executing tool '{}' on server '{}' with args: {}", tool_name, server_name, arguments);

        // Verify server is running
        {
            let servers = self.servers.lock().unwrap();
            if let Some(server) = servers.get(server_name) {
                if !server.is_running {
                    return Err(format!("MCP server '{}' is not running", server_name));
                }
                
                // Check if tool exists in discovered tools, but allow execution even if not pre-discovered
                let tool_exists = server.tools.iter().any(|t| t.name == tool_name);
                if !tool_exists && !server.tools.is_empty() {
                    // Only reject if we have discovered tools but this isn't one of them
                    return Err(format!("Tool '{}' not found on server '{}' (found {} other tools)", tool_name, server_name, server.tools.len()));
                } else if !tool_exists {
                    // No tools were discovered, but we'll try anyway - some servers don't support tools/list
                    println!("⚠️ Tool '{}' not pre-discovered on server '{}', attempting execution anyway", tool_name, server_name);
                }
            } else {
                return Err(format!("MCP server '{}' not found", server_name));
            }
        }

        let tool_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: "tools/call".to_string(),
            params: Some(serde_json::json!({
                "name": tool_name,
                "arguments": arguments
            })),
        };

        match self.send_request_with_retry(server_name, &tool_request, 2).await {
            Ok(response) => {
                if let Some(error) = response.error {
                    Err(format!("Tool execution error: {} (code: {})", error.message, error.code))
                } else if let Some(result) = response.result {
                    // If tool executed successfully but wasn't pre-discovered, add it dynamically
                    {
                        let mut servers = self.servers.lock().unwrap();
                        if let Some(server) = servers.get_mut(server_name) {
                            let tool_exists = server.tools.iter().any(|t| t.name == tool_name);
                            if !tool_exists {
                                println!("✅ Tool '{}' executed successfully on '{}', adding to discovered tools", tool_name, server_name);
                                server.tools.push(McpTool {
                                    name: tool_name.to_string(),
                                    description: Some(format!("Dynamically discovered tool from server {}", server_name)),
                                    input_schema: serde_json::json!({
                                        "type": "object",
                                        "description": "Schema not available - tool was dynamically discovered"
                                    }),
                                });
                                println!("📊 Server '{}' now has {} tools total", server_name, server.tools.len());
                            }
                        }
                    }
                    Ok(result)
                } else {
                    Err("Tool execution returned empty result".to_string())
                }
            }
            Err(e) => Err(format!("Failed to execute tool '{}': {}", tool_name, e))
        }
    }

    pub fn get_all_tools(&self) -> Vec<(String, McpTool)> {
        let servers = self.servers.lock().unwrap();
        let mut all_tools = Vec::new();

        for (server_name, server) in servers.iter() {
            if server.is_running {
                for tool in &server.tools {
                    all_tools.push((server_name.clone(), tool.clone()));
                }
            }
        }

        all_tools
    }

    pub fn get_all_resources(&self) -> Vec<(String, McpResource)> {
        let servers = self.servers.lock().unwrap();
        let mut all_resources = Vec::new();

        for (server_name, server) in servers.iter() {
            if server.is_running {
                for resource in &server.resources {
                    all_resources.push((server_name.clone(), resource.clone()));
                }
            }
        }

        all_resources
    }

    pub fn get_server_status(&self) -> HashMap<String, bool> {
        let servers = self.servers.lock().unwrap();
        servers.iter()
            .map(|(name, server)| (name.clone(), server.is_running))
            .collect()
    }

    pub fn get_debug_server_info(&self) -> Vec<String> {
        let servers = self.servers.lock().unwrap();
        let mut debug_info = Vec::new();
        
        for (name, server) in servers.iter() {
            let mut server_info = format!("Server '{}': Command: {} {:?}", 
                name, server.command, server.args);
            server_info.push_str(&format!("\n  Running: {}", server.is_running));
            server_info.push_str(&format!("\n  Tools Count: {}", server.tools.len()));
            server_info.push_str(&format!("\n  Resources Count: {}", server.resources.len()));
            server_info.push_str(&format!("\n  Has stdin: {}", server.stdin_tx.is_some()));
            server_info.push_str(&format!("\n  Process handle: {}", server.process_handle.is_some()));
            
            // Response buffer info
            if let Ok(buffer) = server.response_buffer.lock() {
                server_info.push_str(&format!("\n  Response buffer size: {}", buffer.len()));
                if !buffer.is_empty() {
                    server_info.push_str(&format!("\n  Latest response: {}", 
                        buffer.back().map(|e| e.content.as_str()).unwrap_or("None")));
                }
            }
            
            debug_info.push(server_info);
        }
        
        debug_info
    }

    pub async fn stop_server(&self, server_name: &str) -> Result<(), String> {
        println!("Stopping MCP server '{}'", server_name);
        
        // Get the process handle and other resources
        let (process_handle, stdin_tx) = {
            let mut servers = self.servers.lock().unwrap();
            if let Some(server) = servers.get_mut(server_name) {
                server.is_running = false;
                let handle = server.process_handle.take();
                let stdin = server.stdin_tx.take();
                (handle, stdin)
            } else {
                return Err(format!("Server '{}' not found", server_name));
            }
        };
        
        // Close stdin channel to signal shutdown
        drop(stdin_tx);
        
        // Terminate the process if it exists
        if let Some(handle) = process_handle {
            // Clone the Arc to avoid holding the lock across await
            let handle_clone = handle.clone();
            
            // Kill the process
            {
                let mut child = handle.lock().await;
                if let Err(e) = child.start_kill() {
                    eprintln!("Failed to kill MCP server '{}' process: {}", server_name, e);
                }
            } // Lock is dropped here
            
            // Wait for the process to exit
            let wait_result = tokio::spawn(async move {
                let mut child = handle_clone.lock().await;
                child.wait().await
            });
            
            match tokio::time::timeout(Duration::from_secs(5), wait_result).await {
                Ok(Ok(Ok(status))) => {
                    println!("MCP server '{}' exited with status: {:?}", server_name, status);
                }
                Ok(Ok(Err(e))) => {
                    eprintln!("Error waiting for MCP server '{}' to exit: {}", server_name, e);
                }
                Ok(Err(e)) => {
                    eprintln!("Task error waiting for MCP server '{}' to exit: {}", server_name, e);
                }
                Err(_) => {
                    eprintln!("Timeout waiting for MCP server '{}' to exit", server_name);
                }
            }
        }
        
        println!("MCP server '{}' stopped successfully", server_name);
        Ok(())
    }

    async fn start_health_monitor(&self, server_name: &str) -> Result<(), String> {
        let servers = self.servers.clone();
        let server_name = server_name.to_string();
        
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                
                let (should_check, process_handle) = {
                    let mut servers_guard = servers.lock().unwrap();
                    if let Some(server) = servers_guard.get_mut(&server_name) {
                        if !server.is_running {
                            (false, None) // Server was stopped, exit monitoring
                        } else {
                            server.last_health_check = Instant::now();
                            (true, server.process_handle.clone())
                        }
                    } else {
                        (false, None) // Server removed, exit monitoring
                    }
                };
                
                if !should_check {
                    println!("Health monitor for MCP server '{}' stopping", server_name);
                    break;
                }
                
                // Check if process is still alive
                if let Some(process_handle) = process_handle {
                    let is_alive = {
                        let mut child = process_handle.lock().await;
                        match child.try_wait() {
                            Ok(None) => true, // Process is still running
                            Ok(Some(status)) => {
                                println!("MCP server '{}' exited unexpectedly with status: {:?}", server_name, status);
                                false
                            }
                            Err(e) => {
                                eprintln!("Error checking MCP server '{}' process status: {}", server_name, e);
                                false
                            }
                        }
                    };
                    
                    if !is_alive {
                        // Mark server as not running
                        let mut servers_guard = servers.lock().unwrap();
                        if let Some(server) = servers_guard.get_mut(&server_name) {
                            server.is_running = false;
                            server.process_handle = None;
                            server.stdin_tx = None;
                        }
                        break;
                    } else {
                        println!("Health check passed for MCP server '{}'", server_name);
                    }
                }
            }
        });
        
        Ok(())
    }
}