use tauri_plugin_shell::ShellExt;
use crate::utils::get_free_port;

#[tauri::command]
pub async fn start_ollama_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
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
pub async fn stop_ollama_server() -> Result<String, String> {
    println!("Stopping Ollama server...");

    std::process::Command::new("pkill")
        .args(&["-f", "ollama"])
        .output()
        .map_err(|e| format!("Failed to stop Ollama: {}", e))?;

    println!("Ollama server stopped");
    Ok("Ollama server stopped".to_string())
}
