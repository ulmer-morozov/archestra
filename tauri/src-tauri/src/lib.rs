use tauri_plugin_shell;
use tauri_plugin_opener;
use tauri::{Manager};
use std::sync::Arc;
use tauri_plugin_deep_link::DeepLinkExt;

pub mod utils;
pub mod ollama;
pub mod mcp;
pub mod database;
pub mod mcp_bridge;
pub mod oauth;

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
            let mcp_bridge = Arc::new(mcp_bridge::McpBridge::new());
            app.manage(mcp_bridge::McpBridgeState(mcp_bridge));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::start_ollama_server,
            ollama::stop_ollama_server,
            ollama::ollama_chat_with_tools,
            ollama::ollama_chat_with_tools_streaming,
            mcp::run_mcp_server_in_sandbox,
            mcp::save_mcp_server,
            mcp::load_mcp_servers,
            mcp::delete_mcp_server,
            mcp_bridge::start_persistent_mcp_server,
            mcp_bridge::stop_persistent_mcp_server,
            mcp_bridge::get_mcp_tools,
            mcp_bridge::get_mcp_server_status,
            mcp_bridge::execute_mcp_tool,
            mcp_bridge::debug_mcp_bridge,
            oauth::start_gmail_auth,
            oauth::save_gmail_tokens,
            oauth::load_gmail_tokens,
            oauth::check_oauth_proxy_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
