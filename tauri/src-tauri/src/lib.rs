// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_shell;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use rusqlite::{Connection, Result};
use std::path::Path;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct McpServerDefinition {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct McpServersConfig {
    pub mcp_servers: std::collections::HashMap<String, McpServerDefinition>,
}

#[tauri::command]
async fn run_mcp_server_in_sandbox(
    _app: tauri::AppHandle,
    server_name: String,
    config: McpServerDefinition,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;

    println!("Starting MCP server '{}' in sandbox", server_name);

    // Build the command with all arguments
    let mut child = TokioCommand::new("sandbox-exec")
        .arg("-f").arg("./sandbox-exec-profiles/mcp-server-everything-for-now.sb")
        .arg(&config.command)
        .args(&config.args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sandboxed MCP server: {}", e))?;

    println!("MCP server '{}' started in sandbox!", server_name);

    // Handle stdout
    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        let server_name_clone = server_name.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                print!("[MCP Server '{}' stdout] {}\n", server_name_clone, line);
            }
        });
    }

    // Handle stderr
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        let server_name_clone = server_name.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                eprint!("[MCP Server '{}' stderr] {}\n", server_name_clone, line);
            }
        });
    }

    // Wait for the process to complete
    match child.wait().await {
        Ok(status) => {
            if status.success() {
                Ok(format!("MCP server '{}' completed successfully", server_name))
            } else {
                Ok(format!("MCP server '{}' exited with status: {:?}", server_name, status))
            }
        }
        Err(e) => Err(format!("MCP server failed: {}", e))
    }
}

#[tauri::command]
async fn start_ollama_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
    use tauri_plugin_shell::process::CommandEvent;

    let port = get_free_port();
    println!("Starting Ollama server as sidecar on port {}...", port);

    let sidecar_result = app_handle.shell()
        .sidecar("ollama")
        .unwrap()
        .env("OLLAMA_HOST", format!("127.0.0.1:{}", port))
        .args(&["serve"])
        .spawn();

    match sidecar_result {
        Ok((mut rx, _child)) => {
            println!("Ollama server started successfully on port {}!", port);

            // Handle output in background
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line_bytes) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            print!("[Ollama stdout] {}", line);
                        }
                        CommandEvent::Stderr(line_bytes) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            eprint!("[Ollama stderr] {}", line);
                        }
                        _ => {}
                    }
                }
            });

            Ok(port)
        }
        Err(e) => {
            let error_msg = format!("Failed to start Ollama server: {:?}", e);
            eprintln!("{}", error_msg);
            Err(error_msg)
        }
    }
}

#[tauri::command]
async fn stop_ollama_server() -> Result<(), String> {
    println!("Stopping Ollama server...");
    
    std::process::Command::new("pkill")
        .args(&["-f", "ollama"])
        .output()
        .map_err(|e| format!("Failed to stop Ollama: {}", e))?;
    
    println!("Ollama server stopped");
    Ok(())
}

fn get_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // NOTE: can use this portion to start sidecars when the app launches
            // Start the node.js express-server sidecar when the app launches
            // let app_handle = app.handle().clone();
            // let port = get_free_port();
            // app.manage(PortState(Mutex::new(port)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![run_mcp_server_in_sandbox, start_ollama_server, stop_ollama_server, save_mcp_server, load_mcp_servers, delete_mcp_server])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct PortState(pub Mutex<u16>);

fn init_database(data_dir: &Path) -> Result<Connection> {
    let db_path = data_dir.join("mcp_servers.db");
    let conn = Connection::open(db_path)?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS mcp_servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            command TEXT NOT NULL,
            args TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    
    Ok(conn)
}

#[tauri::command]
async fn save_mcp_server(app: tauri::AppHandle, name: String, command: String, args: Vec<String>) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    
    let conn = init_database(&data_dir).map_err(|e| format!("Database error: {}", e))?;
    
    let args_json = serde_json::to_string(&args).map_err(|e| format!("Failed to serialize args: {}", e))?;
    
    conn.execute(
        "INSERT OR REPLACE INTO mcp_servers (name, command, args) VALUES (?1, ?2, ?3)",
        [&name, &command, &args_json],
    ).map_err(|e| format!("Failed to save server: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn load_mcp_servers(app: tauri::AppHandle) -> Result<std::collections::HashMap<String, McpServerDefinition>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
    
    if !data_dir.exists() {
        return Ok(std::collections::HashMap::new());
    }
    
    let conn = init_database(&data_dir).map_err(|e| format!("Database error: {}", e))?;
    
    let mut stmt = conn.prepare("SELECT name, command, args FROM mcp_servers").map_err(|e| format!("Failed to prepare statement: {}", e))?;
    
    let server_iter = stmt.query_map([], |row| {
        let name: String = row.get(0)?;
        let command: String = row.get(1)?;
        let args_json: String = row.get(2)?;
        
        let args: Vec<String> = serde_json::from_str(&args_json).map_err(|_| rusqlite::Error::InvalidColumnType(2, "args".to_string(), rusqlite::types::Type::Text))?;
        
        Ok((name, McpServerDefinition { command, args }))
    }).map_err(|e| format!("Failed to query servers: {}", e))?;
    
    let mut servers = std::collections::HashMap::new();
    for server_result in server_iter {
        let (name, definition) = server_result.map_err(|e| format!("Failed to parse server: {}", e))?;
        servers.insert(name, definition);
    }
    
    Ok(servers)
}

#[tauri::command]
async fn delete_mcp_server(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("Failed to get data dir: {}", e))?;
    
    if !data_dir.exists() {
        return Ok(());
    }
    
    let conn = init_database(&data_dir).map_err(|e| format!("Database error: {}", e))?;
    
    conn.execute("DELETE FROM mcp_servers WHERE name = ?1", [&name])
        .map_err(|e| format!("Failed to delete server: {}", e))?;
    
    Ok(())
}
