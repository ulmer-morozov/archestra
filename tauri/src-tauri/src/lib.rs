// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_shell;
use tauri_plugin_shell::ShellExt;
use tauri::Manager;
use std::sync::Mutex;
use tauri::State;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub package_name: String,
    pub args: Vec<String>,
}

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
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_hello_server_port(state: State<PortState>) -> u16 {
    *state.0.lock().unwrap()
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


fn get_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

async fn start_hello_server(app_handle: tauri::AppHandle, port: u16) {
    use tauri_plugin_shell::process::CommandEvent;
    println!("Ayo, hello-server will use port: {}", port);
    let sidecar_result = app_handle.shell()
        .sidecar("hello-server")
        .unwrap()
        .args(&[port.to_string()])
        .spawn();
    match sidecar_result {
        Ok((mut rx, _child)) => {
            println!("Ayo, hello-server sidecar started up nice and smooth!");
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        print!("[hello-server stdout] {}", line);
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes);
                        eprint!("[hello-server stderr] {}", line);
                    }
                    _ => {}
                }
            }
        }
        Err(e) => {
            eprintln!("Madone! Failed to spawn hello-server sidecar: {:?}", e);
        }
    }
}

async fn start_malicious_mcp_server() {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command as TokioCommand;

    let arch = std::env::consts::ARCH; // "aarch64" or "x86_64"
    let os = std::env::consts::OS;     // "macos"
    let platform = if os == "macos" {
        format!("{}-apple-darwin", arch)
    } else {
        format!("{}-{}", arch, os)
    };
    let binary_name = format!("malicious-mcp-server-{}", platform);
    let binary_path = std::path::Path::new("binaries").join(&binary_name);

    let mut child = TokioCommand::new("sandbox-exec")
        // NOTE: allow-everything.sb is a profile that will allow that script to work
        // and print out the ssh key
        // .arg("-f").arg("./sandbox-exec-profiles/allow-everything.sb")
        .arg("-f").arg("./sandbox-exec-profiles/super-restrictive.sb")
        .arg(binary_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn sandbox-exec");

    println!("Ayo, malicious-mcp-server (sandboxed) started up, fuggedaboutit!");

    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout).lines();
        tauri::async_runtime::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                print!("[malicious-mcp-server (sandboxed) stdout] {}\n", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        tauri::async_runtime::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                eprint!("[malicious-mcp-server (sandboxed) stderr] {}\n", line);
            }
        });
    }
    let _ = child.wait().await;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Start the node.js express-server sidecar when the app launches
            let app_handle = app.handle().clone();
            let port = get_free_port();
            app.manage(PortState(Mutex::new(port)));

            // Start hello-server
            let app_handle_clone = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                start_hello_server(app_handle_clone, port).await;
            });

            // Start malicious-mcp-server
            tauri::async_runtime::spawn(async move {
                start_malicious_mcp_server().await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, get_hello_server_port, run_mcp_server_in_sandbox])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct PortState(pub Mutex<u16>);
