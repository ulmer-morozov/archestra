use tauri_plugin_shell;
use tauri::Manager;
use std::sync::Arc;

pub mod utils;
pub mod ollama;
pub mod mcp;
pub mod database;
pub mod mcp_bridge;

use mcp_bridge::McpBridge;

pub struct McpBridgeState(pub Arc<McpBridge>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Create the database if it doesn't exist
            let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
            std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;

            println!("Initializing database...");
            database::init_database().map_err(|e| format!("Database error: {}", e))?;
            println!("Database initialized successfully");

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
            debug_mcp_bridge,
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

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct OllamaToolCall {
    name: String,
    arguments: serde_json::Value,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
    tool_calls: Option<Vec<OllamaToolCall>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
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

    // Prepare the request to Ollama
    let request_body = serde_json::json!({
        "model": model,
        "messages": messages,
        "tools": ollama_tools,
        "stream": false
    });

    println!("Sending request to Ollama with {} tools", ollama_tools.len());

    // Send request to Ollama
    let client = reqwest::Client::new();
    let response = client
        .post(format!("http://localhost:{}/api/chat", port))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to Ollama: {}", e))?;

    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let response_data: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Check if the response contains tool calls
    if let Some(message) = response_data.get("message") {
        if let Some(tool_calls) = message.get("tool_calls") {
            if let Some(tool_calls_array) = tool_calls.as_array() {
                println!("Ollama requested {} tool calls", tool_calls_array.len());
                
                // Execute each tool call
                let mut tool_results = Vec::new();
                for tool_call in tool_calls_array {
                    if let Some(function) = tool_call.get("function") {
                        if let Some(name) = function.get("name").and_then(|n| n.as_str()) {
                            if let Some(arguments) = function.get("arguments") {
                                // Parse server name and tool name from the combined name
                                if let Some((server_name, tool_name)) = name.split_once('_') {
                                    println!("Executing tool '{}' on server '{}'", tool_name, server_name);
                                    
                                    match bridge_state.0.execute_tool(server_name, tool_name, arguments.clone()).await {
                                        Ok(result) => {
                                            tool_results.push(OllamaToolResponse {
                                                role: "tool".to_string(),
                                                content: result.to_string(),
                                                tool_call_id: tool_call.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()),
                                            });
                                        }
                                        Err(e) => {
                                            tool_results.push(OllamaToolResponse {
                                                role: "tool".to_string(),
                                                content: format!("Error executing tool: {}", e),
                                                tool_call_id: tool_call.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()),
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Return the response with tool results
                return Ok(serde_json::json!({
                    "message": message,
                    "tool_results": tool_results
                }));
            }
        }
    }

    // Return regular response if no tool calls
    Ok(response_data)
}

#[tauri::command]
async fn debug_mcp_bridge(app: tauri::AppHandle) -> Result<String, String> {
    let bridge_state = app.state::<McpBridgeState>();
    let tools = bridge_state.0.get_all_tools();
    let statuses = bridge_state.0.get_server_status();
    
    Ok(format!("MCP Bridge Debug:\nTools: {:?}\nStatuses: {:?}", tools, statuses))
}