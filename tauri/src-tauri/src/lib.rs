use tauri_plugin_shell;
use tauri::Manager;

pub mod utils;
pub mod ollama;
pub mod mcp;
pub mod database;


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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::start_ollama_server,
            ollama::stop_ollama_server,
            mcp::run_mcp_server_in_sandbox,
            mcp::save_mcp_server,
            mcp::load_mcp_servers,
            mcp::delete_mcp_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
