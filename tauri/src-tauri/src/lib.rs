use tauri_plugin_shell;
use tauri_plugin_opener;
use tauri::{Manager, Emitter};
use std::sync::Arc;
use tauri_plugin_deep_link::DeepLinkExt;

pub mod utils;
pub mod ollama;
pub mod mcp;
pub mod database;
pub mod mcp_bridge;
pub mod oauth;

use mcp_bridge::McpBridge;

pub struct McpBridgeState(pub Arc<McpBridge>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Load .env file
            utils::load_dotenv_file()
                .map_err(|e| format!("Failed to load .env file: {}", e))?;

            // Initialize database
            database::init_database(app.handle().clone())
                .map_err(|e| format!("Database error: {}", e))?;

            // Initialize Gmail OAuth proxy
            let _ = oauth::start_oauth_proxy(app.handle().clone());

            // Start all persisted MCP servers
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = mcp::start_all_mcp_servers(app_handle).await {
                    eprintln!("Failed to start MCP servers: {}", e);
                }
            });

            // Handle OAuth callback deep links
            // https://v2.tauri.app/plugin/deep-linking/#listening-to-deep-links
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                println!("deep link URLs: {:?}", urls);
                for url in urls {
                    let app_handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        oauth::handle_oauth_callback(app_handle, url.to_string()).await;
                    });
                }
            });

            // Initialize MCP bridge
            let mcp_bridge = Arc::new(McpBridge::new());
            app.manage(McpBridgeState(mcp_bridge));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::start_ollama_server,
            ollama::stop_ollama_server,
            mcp::run_mcp_server_in_sandbox,
            mcp::save_mcp_server,
            mcp::load_mcp_servers,
            mcp::delete_mcp_server,
            start_persistent_mcp_server,
            stop_persistent_mcp_server,
            get_mcp_tools,
            get_mcp_server_status,
            execute_mcp_tool,
            ollama_chat_with_tools,
            ollama_chat_with_tools_streaming,
            debug_mcp_bridge,
            oauth::start_gmail_auth,
            oauth::save_gmail_tokens,
            oauth::load_gmail_tokens,
            oauth::check_oauth_proxy_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// MCP Bridge related commands
#[tauri::command]
async fn start_persistent_mcp_server(
    app: tauri::AppHandle,
    name: String,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    let bridge_state = app.state::<McpBridgeState>();
    bridge_state.0.start_mcp_server(name, command, args).await
}

#[tauri::command]
async fn stop_persistent_mcp_server(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let bridge_state = app.state::<McpBridgeState>();
    bridge_state.0.stop_server(&name).await
}

#[tauri::command]
async fn get_mcp_tools(app: tauri::AppHandle) -> Result<Vec<(String, mcp_bridge::McpTool)>, String> {
    let bridge_state = app.state::<McpBridgeState>();
    Ok(bridge_state.0.get_all_tools())
}

#[tauri::command]
async fn get_mcp_server_status(app: tauri::AppHandle) -> Result<std::collections::HashMap<String, bool>, String> {
    let bridge_state = app.state::<McpBridgeState>();
    Ok(bridge_state.0.get_server_status())
}

#[tauri::command]
async fn execute_mcp_tool(
    app: tauri::AppHandle,
    server_name: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let bridge_state = app.state::<McpBridgeState>();
    bridge_state.0.execute_tool(&server_name, &tool_name, arguments).await
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct OllamaToolCall {
    name: String,
    arguments: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
    tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct OllamaToolResponse {
    role: String,
    content: String,
    tool_call_id: Option<String>,
}

#[tauri::command]
async fn ollama_chat_with_tools(
    app: tauri::AppHandle,
    port: u16,
    model: String,
    messages: Vec<OllamaMessage>,
) -> Result<serde_json::Value, String> {
    let bridge_state = app.state::<McpBridgeState>();
    let available_tools = bridge_state.0.get_all_tools();
    
    // Convert MCP tools to Ollama tool format
    let mut ollama_tools = Vec::new();
    for (server_name, tool) in &available_tools {
        ollama_tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": format!("{}_{}", server_name, tool.name),
                "description": tool.description.clone().unwrap_or_else(|| format!("Tool {} from server {}", tool.name, server_name)),
                "parameters": tool.input_schema.clone()
            }
        }));
    }

    // Prepare the request to Ollama with optimal Qwen3 settings
    let request_body = serde_json::json!({
        "model": model,
        "messages": messages,
        "tools": ollama_tools,
        "stream": true,
        "options": {
            "temperature": 0.6,
            "top_p": 0.95,
            "top_k": 20,
            "num_predict": 32768
        }
    });

    println!("Sending request to Ollama with {} tools", ollama_tools.len());

    // Send request to Ollama with streaming
    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://localhost:{}/api/chat", port))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;

    let mut full_content = String::new();
    let mut final_message: Option<serde_json::Value> = None;

    // Process streaming response
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk) = stream.next().await {
        let chunk_bytes = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;
        let chunk_text = String::from_utf8_lossy(&chunk_bytes);
        
        for line in chunk_text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            
            if let Ok(chunk_data) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(message) = chunk_data.get("message") {
                    // Accumulate content
                    if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
                        full_content.push_str(content);
                    }
                    

                    
                    // Store the final message structure
                    final_message = Some(message.clone());
                }
                
                // If this is the final chunk, break
                if chunk_data.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                    break;
                }
            }
        }
    }

    // Create response data structure
    let response_data = if let Some(mut msg) = final_message {
        // Update message with full accumulated content
        if let Some(content) = msg.get_mut("content") {
            *content = serde_json::Value::String(full_content);
        }
        
        serde_json::json!({
            "message": msg,
            "streaming": true
        })
    } else {
        serde_json::json!({
            "message": {
                "content": full_content,
                "role": "assistant"
            },
            "streaming": true
        })
    };

    // Check if the response contains tool calls
    let Some(message) = response_data.get("message") else {
        return Ok(response_data);
    };
    
    let Some(tool_calls_array) = message.get("tool_calls").and_then(|tc| tc.as_array()) else {
        return Ok(response_data);
    };
    
    println!("Ollama requested {} tool calls", tool_calls_array.len());
    
    // Execute each tool call
    let mut tool_results = Vec::new();
    for tool_call in tool_calls_array {
        let tool_call_id = tool_call.get("id").and_then(|id| id.as_str()).map(|s| s.to_string());
        
        // Extract function details with early continue on failure
        let Some(function) = tool_call.get("function") else { continue; };
        let Some(name) = function.get("name").and_then(|n| n.as_str()) else { continue; };
        let Some(arguments) = function.get("arguments") else { continue; };
        let Some((server_name, tool_name)) = name.split_once('_') else { continue; };
        
        println!("Executing tool '{}' on server '{}'", tool_name, server_name);
        
        let content = match bridge_state.0.execute_tool(server_name, tool_name, arguments.clone()).await {
            Ok(result) => {
                // Format the result to be human-readable
                if let Some(content) = result.get("content").and_then(|c| c.as_str()) {
                    // If the result has a 'content' field, extract and format it
                    content.replace("\\n", "\n").replace("\\\"", "\"")
                } else if result.is_string() {
                    // If it's a plain string, unescape it
                    result.as_str().unwrap_or("").replace("\\n", "\n").replace("\\\"", "\"")
                } else {
                    // For other JSON structures, pretty print them
                    serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string())
                }
            },
            Err(e) => format!("Error executing tool: {}", e),
        };
        
        tool_results.push(OllamaToolResponse {
            role: "tool".to_string(),
            content,
            tool_call_id,
        });
    }
    
    // Return the response with tool results
    Ok(serde_json::json!({
        "message": message,
        "tool_results": tool_results
    }))
}

#[tauri::command]
async fn ollama_chat_with_tools_streaming(
    app: tauri::AppHandle,
    port: u16,
    model: String,
    messages: Vec<OllamaMessage>,
) -> Result<(), String> {
    let bridge_state = app.state::<McpBridgeState>();
    let available_tools = bridge_state.0.get_all_tools();
    
    // Convert MCP tools to Ollama tool format and create system message
    let mut ollama_tools = Vec::new();
    let mut tool_descriptions = Vec::new();
    
    println!("🔧 Converting {} MCP tools to Ollama format", available_tools.len());
    for (server_name, tool) in &available_tools {
        let tool_name = format!("{}_{}", server_name, tool.name);
        let tool_desc = tool.description.clone().unwrap_or_else(|| format!("Tool {} from server {}", tool.name, server_name));
        
        println!("  🛠️ Converting tool '{}' from server '{}'", tool.name, server_name);
        println!("     Ollama name: {}", tool_name);
        println!("     Description: {}", tool_desc);
        println!("     Schema: {}", tool.input_schema);
        
        tool_descriptions.push(format!("- {}: {}", tool_name, tool_desc));
        
        ollama_tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": tool_name,
                "description": tool_desc,
                "parameters": tool.input_schema.clone()
            }
        }));
    }
    
    // Prepare messages with tool awareness
    let mut enhanced_messages = messages.clone();
    if !available_tools.is_empty() {
        let tool_system_message = OllamaMessage {
            role: "system".to_string(),
            content: format!(
                "You have access to the following tools:\n{}\n\nUse these tools when they can help answer the user's questions. When you need to think through a problem, wrap your reasoning in <think></think> tags.",
                tool_descriptions.join("\n")
            ),
            tool_calls: None,
        };
        enhanced_messages.insert(0, tool_system_message);
    }

    // Prepare the request to Ollama with optimal Qwen3 settings
    let request_body = serde_json::json!({
        "model": model,
        "messages": enhanced_messages,
        "tools": ollama_tools,
        "stream": true,
        "options": {
            "temperature": 0.6,
            "top_p": 0.95,
            "top_k": 20,
            "num_predict": 32768
        }
    });

    println!("Sending streaming request to Ollama with {} tools", ollama_tools.len());

    // Send request to Ollama with streaming
    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://localhost:{}/api/chat", port))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;

    let mut full_content = String::new();
    let mut final_message: Option<serde_json::Value> = None;
    let mut captured_tool_calls: Option<serde_json::Value> = None;
    
    // Process streaming response
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk) = stream.next().await {
        let chunk_bytes = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;
        let chunk_text = String::from_utf8_lossy(&chunk_bytes);
        
        for line in chunk_text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            
                            if let Ok(chunk_data) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(message) = chunk_data.get("message") {
                    // Check for tool calls in streaming chunks
                    if let Some(tool_calls) = message.get("tool_calls") {
                        println!("🔧 Tool calls detected in streaming chunk: {}", message);
                        captured_tool_calls = Some(tool_calls.clone());
                        println!("💾 Captured tool calls: {}", tool_calls);
                    }
                    
                    // Send chunk to frontend
                    if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
                        if !content.is_empty() {
                            full_content.push_str(content);
                            let _ = app.emit("ollama-chunk", serde_json::json!({
                                "content": content,
                                "total_content": full_content
                            }));
                        }
                    }
                    
                    // Store the final message structure
                    final_message = Some(message.clone());
                }
                
                // If this is the final chunk, break
                if chunk_data.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                    break;
                }
            }
        }
    }

    // Check for tool calls in captured tool calls or final message
        println!("🏁 Ollama streaming completed, checking for tool calls...");
        
        // Use captured tool calls from streaming chunks if available, otherwise check final message
        let tool_calls_to_use = if let Some(captured) = &captured_tool_calls {
            println!("🎯 Using captured tool calls from streaming chunks: {}", captured);
            captured.as_array()
        } else if let Some(message) = &final_message {
            println!("🔍 Checking final message for tool calls: {}", serde_json::to_string_pretty(message).unwrap_or_else(|_| "Failed to serialize".to_string()));
            message.get("tool_calls").and_then(|tc| tc.as_array())
        } else {
            None
        };
        
        if let Some(tool_calls_array) = tool_calls_to_use {
            if !tool_calls_array.is_empty() {
                let source = if captured_tool_calls.is_some() { "streaming chunks" } else { "final message" };
                println!("🎯 Ollama requested {} tool calls from {}", tool_calls_array.len(), source);
                
                // Execute each tool call
                let mut tool_results = Vec::new();
                for tool_call in tool_calls_array {
                    let tool_call_id = tool_call.get("id").and_then(|id| id.as_str()).map(|s| s.to_string());
                    
                    // Extract function details with early continue on failure
                    let Some(function) = tool_call.get("function") else { continue; };
                    let Some(name) = function.get("name").and_then(|n| n.as_str()) else { continue; };
                    let Some(arguments) = function.get("arguments") else { continue; };
                    let Some((server_name, tool_name)) = name.split_once('_') else { continue; };
                    
                    println!("Executing tool '{}' on server '{}'", tool_name, server_name);
                    
                    let content = match bridge_state.0.execute_tool(server_name, tool_name, arguments.clone()).await {
                        Ok(result) => {
                            // Format the result to be human-readable
                            if let Some(content) = result.get("content").and_then(|c| c.as_str()) {
                                // If the result has a 'content' field, extract and format it
                                content.replace("\\n", "\n").replace("\\\"", "\"")
                            } else if result.is_string() {
                                // If it's a plain string, unescape it
                                result.as_str().unwrap_or("").replace("\\n", "\n").replace("\\\"", "\"")
                            } else {
                                // For other JSON structures, pretty print them
                                serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string())
                            }
                        },
                        Err(e) => format!("Error executing tool: {}", e),
                    };
                    
                    tool_results.push(OllamaToolResponse {
                        role: "tool".to_string(),
                        content,
                        tool_call_id,
                    });
                }
                
                // Send tool results to frontend
                let message_for_results = if let Some(message) = &final_message {
                    message.clone()
                } else {
                    // Create synthetic message with captured tool calls
                    serde_json::json!({
                        "role": "assistant",
                        "content": full_content,
                        "tool_calls": captured_tool_calls.unwrap_or_else(|| serde_json::json!([]))
                    })
                };
                
                let _ = app.emit("ollama-tool-results", serde_json::json!({
                    "message": message_for_results,
                    "tool_results": tool_results
                }));
            }
        } else {
            println!("❌ No tool calls found in streaming chunks or final message");
            if captured_tool_calls.is_none() && final_message.is_none() {
                println!("   🔍 Neither captured tool calls nor final message available");
            } else if captured_tool_calls.is_none() {
                println!("   📝 Final message available but no tool calls detected");
            }
        }
    
    // Send completion event
    let _ = app.emit("ollama-complete", serde_json::json!({
        "content": full_content
    }));

    Ok(())
}

#[tauri::command]
async fn debug_mcp_bridge(app: tauri::AppHandle) -> Result<String, String> {
    let bridge_state = app.state::<McpBridgeState>();
    let tools = bridge_state.0.get_all_tools();
    let statuses = bridge_state.0.get_server_status();
    
    let mut debug_info = String::new();
    debug_info.push_str(&format!("=== MCP Bridge Debug ===\n"));
    debug_info.push_str(&format!("Server Count: {}\n", statuses.len()));
    debug_info.push_str(&format!("Total Tools: {}\n\n", tools.len()));
    
    debug_info.push_str("=== Server Status ===\n");
    for (server_name, is_running) in &statuses {
        debug_info.push_str(&format!("{}: {}\n", server_name, if *is_running { "🟢 Running" } else { "🔴 Stopped" }));
    }
    
    debug_info.push_str("\n=== Discovered Tools ===\n");
    if tools.is_empty() {
        debug_info.push_str("❌ No tools discovered\n");
    } else {
        for (server_name, tool) in &tools {
            debug_info.push_str(&format!("Server '{}': Tool '{}'\n", server_name, tool.name));
            if let Some(desc) = &tool.description {
                debug_info.push_str(&format!("  Description: {}\n", desc));
            }
            debug_info.push_str(&format!("  Schema: {}\n", tool.input_schema));
        }
    }
    
    debug_info.push_str("\n=== Detailed Server Info ===\n");
    debug_info.push_str(&format!("{:#?}", bridge_state.0.get_debug_server_info()));
    
    Ok(debug_info)
}
