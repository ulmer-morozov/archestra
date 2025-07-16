// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_shell;
use tauri_plugin_shell::ShellExt;
use tauri::Manager;
use std::sync::Mutex;
use tauri::State;
// use tauri::api::path::resolve_resource;
// use tauri_plugin_shell::process::CommandEvent;
use std::process::Command;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_hello_server_port(state: State<PortState>) -> u16 {
    *state.0.lock().unwrap()
}

fn get_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

// #[tauri::command]
// async fn run_node_server_sidecar(app: tauri::AppHandle) -> Result<String, String> {
//     let sidecar_command = app.shell().sidecar("binaries/hello-server").map_err(|e| e.to_string())?;
//     let (mut rx, mut _child) = sidecar_command.spawn().map_err(|e| e.to_string())?;
//     let mut output = String::new();
//     while let Some(event) = rx.recv().await {
//         if let CommandEvent::Stdout(line_bytes) = event {
//             let line = String::from_utf8_lossy(&line_bytes);
//             output.push_str(&line);
//         }
//     }
//     Ok(output)
// }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // let sidecar_command = app.shell().sidecar("binaries/hello-server").unwrap();
    // let (mut rx, mut _child) = sidecar_command
    //     .spawn()
    //     .expect("Failed to spawn sidecar");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Start the node.js express-server sidecar when the app launches
            let app_handle = app.handle().clone();
            let port = get_free_port();
            app.manage(PortState(Mutex::new(port)));
            tauri::async_runtime::spawn(async move {
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
            });

            // Now using sandbox-exec to run malicious-mcp-server with logging
            // let app_handle2 = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use std::process::Stdio;
                use tokio::io::{AsyncBufReadExt, BufReader};
                use tokio::process::Command as TokioCommand;

                // let resource_dir = app_handle2.path().resource_dir().expect("no resource dir");
                let arch = std::env::consts::ARCH; // "aarch64" or "x86_64"
                let os = std::env::consts::OS;     // "macos"
                let platform = if os == "macos" {
                    format!("{}-apple-darwin", arch)
                } else {
                    format!("{}-{}", arch, os)
                };
                let binary_name = format!("malicious-mcp-server-{}", platform);
                let binary_path = std::path::Path::new("binaries").join(&binary_name);

                println!("binary_path: {:?}", binary_path);

                let mut child = TokioCommand::new("sandbox-exec")
                    // NOTE: allow-everything.sb is a profile that will allow that script to work
                    // and print out the ssh key
                    // .arg("-f").arg("./allow-everything.sb")
                    .arg("-f").arg("./super-restrictive.sb")
                    .arg("./binaries/malicious-mcp-server-aarch64-apple-darwin")
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, get_hello_server_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub struct PortState(pub Mutex<u16>);
