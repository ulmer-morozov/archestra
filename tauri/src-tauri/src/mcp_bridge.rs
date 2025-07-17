use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::mpsc;
use uuid::Uuid;

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

#[derive(Debug)]
pub struct McpServer {
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub command: String,
    #[allow(dead_code)]
    pub args: Vec<String>,
    pub tools: Vec<McpTool>,
    #[allow(dead_code)]
    pub resources: Vec<McpResource>,
    pub stdin_tx: Option<mpsc::Sender<String>>,
    pub response_buffer: Arc<Mutex<VecDeque<String>>>,
    pub is_running: bool,
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

        let mut child = TokioCommand::new("sandbox-exec")
            .arg("-f")
            .arg("./sandbox-exec-profiles/mcp-server-everything-for-now.sb")
            .arg(&command)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

        // Handle stderr
        let server_name_clone = name.clone();
        tokio::spawn(async move {
            let mut stderr_reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[MCP Server '{}' stderr] {}", server_name_clone, line);
            }
        });

        // Create response buffer
        let response_buffer = Arc::new(Mutex::new(VecDeque::new()));
        
        // Handle stdout with message parsing
        let server_name_clone = name.clone();
        let response_buffer_clone = response_buffer.clone();
        tokio::spawn(async move {
            let mut stdout_reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = stdout_reader.next_line().await {
                println!("[MCP Server '{}' stdout] {}", server_name_clone, line);
                
                // Store response in buffer
                {
                    let mut buffer = response_buffer_clone.lock().unwrap();
                    buffer.push_back(line);
                }
            }
        });

        // Handle stdin with channel communication
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(100);
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(message) = stdin_rx.recv().await {
                if let Err(e) = stdin.write_all(message.as_bytes()).await {
                    eprintln!("Failed to write to stdin: {}", e);
                    break;
                }
                if let Err(e) = stdin.flush().await {
                    eprintln!("Failed to flush stdin: {}", e);
                    break;
                }
            }
        });

        // Create server struct
        let server = McpServer {
            name: name.clone(),
            command,
            args,
            tools: Vec::new(),
            resources: Vec::new(),
            stdin_tx: Some(stdin_tx),
            response_buffer: response_buffer,
            is_running: true,
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

        // Wait for initialize response
        match self.send_request_and_wait(server_name, &init_request).await {
            Ok(response) => {
                println!("Initialize response: {:?}", response);
            }
            Err(e) => {
                println!("Failed to initialize: {}", e);
                return Err(e);
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
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Discover tools
        self.discover_tools(server_name).await?;

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

        // Send request and wait for response
        match self.send_request_and_wait(server_name, &list_tools_request).await {
            Ok(response) => {
                println!("Received response for tools/list: {:?}", response);
                
                if let Some(result) = response.result {
                    println!("Tools list result: {:?}", result);
                    
                    if let Ok(tools_data) = serde_json::from_value::<serde_json::Value>(result) {
                        if let Some(tools_array) = tools_data.get("tools").and_then(|v| v.as_array()) {
                            let mut tools = Vec::new();
                            for tool_value in tools_array {
                                println!("Processing tool: {:?}", tool_value);
                                match serde_json::from_value::<McpTool>(tool_value.clone()) {
                                    Ok(tool) => {
                                        println!("Successfully parsed tool: {}", tool.name);
                                        tools.push(tool);
                                    }
                                    Err(e) => {
                                        println!("Failed to parse tool: {}", e);
                                        // Try to create a minimal tool from the raw data
                                        if let Some(name) = tool_value.get("name").and_then(|v| v.as_str()) {
                                            tools.push(McpTool {
                                                name: name.to_string(),
                                                description: tool_value.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                                input_schema: tool_value.get("inputSchema").cloned().unwrap_or_else(|| serde_json::json!({})),
                                            });
                                        }
                                    }
                                }
                            }

                            // Update server with discovered tools
                            {
                                let mut servers = self.servers.lock().unwrap();
                                if let Some(server) = servers.get_mut(server_name) {
                                    server.tools = tools;
                                    println!("Discovered {} tools for server '{}'", server.tools.len(), server_name);
                                }
                            }
                        } else {
                            println!("No 'tools' array found in response");
                        }
                    } else {
                        println!("Failed to parse tools response as JSON");
                    }
                } else if let Some(error) = response.error {
                    println!("Error response: {:?}", error);
                }
            }
            Err(e) => {
                println!("Failed to get tools list response: {}", e);
            }
        }

        Ok(())
    }

    async fn send_request(&self, server_name: &str, request: &JsonRpcRequest) -> Result<(), String> {
        let request_json = serde_json::to_string(request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;

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
            stdin_tx.send(format!("{}\n", request_json)).await
                .map_err(|e| format!("Failed to send to stdin channel: {}", e))?;
        }

        Ok(())
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
        let start_time = std::time::Instant::now();
        let timeout_duration = std::time::Duration::from_secs(5);
        
        while start_time.elapsed() < timeout_duration {
            // Check response buffer
            {
                let mut buffer = response_buffer.lock().unwrap();
                while let Some(line) = buffer.pop_front() {
                    // Try to parse as JSON-RPC response
                    if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                        if response.id == request.id {
                            return Ok(response);
                        }
                    }
                }
            }
            
            // Wait a bit before checking again
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        Err("Request timed out".to_string())
    }

    pub async fn execute_tool(&self, server_name: &str, tool_name: &str, arguments: serde_json::Value) -> Result<serde_json::Value, String> {
        println!("Executing tool '{}' on server '{}'", tool_name, server_name);

        let tool_request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: Uuid::new_v4().to_string(),
            method: "tools/call".to_string(),
            params: Some(serde_json::json!({
                "name": tool_name,
                "arguments": arguments
            })),
        };

        if let Ok(response) = self.send_request_and_wait(server_name, &tool_request).await {
            if let Some(result) = response.result {
                return Ok(result);
            }
        }

        Err("Tool execution failed".to_string())
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

    pub fn get_server_status(&self) -> HashMap<String, bool> {
        let servers = self.servers.lock().unwrap();
        servers.iter()
            .map(|(name, server)| (name.clone(), server.is_running))
            .collect()
    }

    pub async fn stop_server(&self, server_name: &str) -> Result<(), String> {
        let mut servers = self.servers.lock().unwrap();
        if let Some(server) = servers.get_mut(server_name) {
            server.is_running = false;
            server.stdin_tx = None;
            println!("Stopped MCP server '{}'", server_name);
        }
        Ok(())
    }

    async fn start_health_monitor(&self, server_name: &str) -> Result<(), String> {
        let servers = self.servers.clone();
        let server_name = server_name.to_string();
        
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                
                let should_restart = false;
                let is_running = {
                    let servers = servers.lock().unwrap();
                    if let Some(server) = servers.get(&server_name) {
                        if !server.is_running {
                            false // Server was stopped, exit monitoring
                        } else {
                            // In a real implementation, you would check if the process is still alive
                            // For now, we'll just log that we're monitoring
                            println!("Health check for MCP server '{}'", server_name);
                            true
                        }
                    } else {
                        false // Server removed, exit monitoring
                    }
                };
                
                if !is_running {
                    break;
                }
                
                if should_restart {
                    println!("Restarting MCP server '{}'", server_name);
                    // In a real implementation, you would restart the server here
                }
            }
        });
        
        Ok(())
    }
}