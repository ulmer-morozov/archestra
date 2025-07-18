use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use crate::utils::get_free_port;
use tauri_plugin_opener::OpenerExt;

// Global state for OAuth proxy
static OAUTH_PROXY_PORT: OnceLock<u16> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
pub struct GmailTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expiry_date: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub auth_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthConfig {
    pub google_client_id: String,
    pub google_client_secret: String,
}

fn load_oauth_config() -> Result<OAuthConfig, String> {
    // we can assume that the .env file has already been loaded at app startup

    let google_client_id = std::env::var("GOOGLE_CLIENT_ID")
        .map_err(|_| "GOOGLE_CLIENT_ID not found in .env")?;
    let google_client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
        .map_err(|_| "GOOGLE_CLIENT_SECRET not found in .env")?;

    Ok(OAuthConfig {
        google_client_id,
        google_client_secret,
    })
}

#[tauri::command]
pub async fn start_gmail_auth(app: tauri::AppHandle) -> Result<AuthResponse, String> {
    // Start OAuth proxy if not already running
    let port = get_oauth_proxy_port().ok_or("OAuth proxy not started")?;

    // Call the OAuth proxy service
    let client = reqwest::Client::new();
    let response = client
        .get(format!("http://localhost:{}/auth/gmail", port))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to OAuth proxy: {}", e))?;

    let auth_data: AuthResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse auth response: {}", e))?;

    // Open the auth URL in the system browser
    app.opener().open_url(auth_data.auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("Failed to open auth URL: {}", e))?;

    Ok(auth_data)
}

#[tauri::command]
pub fn save_gmail_tokens(tokens: GmailTokens) -> Result<(), String> {
    use crate::database::get_database_connection;

    let conn = get_database_connection().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Save tokens as JSON in the args field of the MCP server record
    let tokens_json = serde_json::to_string(&tokens)
        .map_err(|e| format!("Failed to serialize tokens: {}", e))?;

    // Insert or replace the Gmail MCP server with tokens
    conn.execute(
        "INSERT OR REPLACE INTO mcp_servers (name, command, args) VALUES (?1, ?2, ?3)",
        ["Gmail MCP Server", "npx", &tokens_json],
    ).map_err(|e| format!("Failed to save Gmail MCP server: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn load_gmail_tokens() -> Result<Option<GmailTokens>, String> {
    use crate::database::get_database_connection;

    let conn = get_database_connection().map_err(|e| format!("Failed to get database connection: {}", e))?;

    // Query for Gmail MCP server tokens
    let mut stmt = conn.prepare("SELECT args FROM mcp_servers WHERE name = 'Gmail MCP Server'")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut rows = stmt.query([])
        .map_err(|e| format!("Failed to execute query: {}", e))?;

    if let Some(row) = rows.next().map_err(|e| format!("Failed to get row: {}", e))? {
        let tokens_json: String = row.get(0)
            .map_err(|e| format!("Failed to get tokens from row: {}", e))?;

        let tokens: GmailTokens = serde_json::from_str(&tokens_json)
            .map_err(|e| format!("Failed to parse tokens: {}", e))?;

        Ok(Some(tokens))
    } else {
        Ok(None)
    }
}

pub fn start_oauth_proxy(app: tauri::AppHandle) -> Result<u16, String> {
    println!("Initializing Gmail OAuth proxy...");

    // Get a free port and store it in global state
    let port = get_free_port();
    OAUTH_PROXY_PORT.set(port).map_err(|_| "Failed to store port")?;

    // Load OAuth configuration from .env file
    let config = load_oauth_config()?;

    println!("Starting OAuth proxy on port: {}", port);

    // Start the OAuth proxy process
    let sidecar_result = app.shell()
        .sidecar("gmail-oauth-proxy")
        .unwrap()
        .env("PORT", port.to_string())
        .env("GOOGLE_CLIENT_ID", config.google_client_id)
        .env("GOOGLE_CLIENT_SECRET", config.google_client_secret)
        .spawn();

    match sidecar_result {
        Ok((mut rx, _child)) => {
            println!("OAuth proxy process started successfully on port: {}", port);

            // Handle output in background
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line_bytes) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            print!("[OAuth Proxy stdout] {}", line);
                        }
                        CommandEvent::Stderr(line_bytes) => {
                            let line = String::from_utf8_lossy(&line_bytes);
                            eprint!("[OAuth Proxy stderr] {}", line);
                        }
                        _ => {}
                    }
                }
            });

            Ok(port)
        }
        Err(e) => {
            let error_msg = format!("Failed to start OAuth proxy: {:?}", e);
            eprintln!("{}", error_msg);
            Err(error_msg)
        }
    }
}

pub fn get_oauth_proxy_port() -> Option<u16> {
    OAUTH_PROXY_PORT.get().copied()
}

#[tauri::command]
pub fn check_oauth_proxy_health() -> Result<bool, String> {
    // Get the port from global state
    let port = get_oauth_proxy_port().ok_or("OAuth proxy not started")?;

    let client = reqwest::blocking::Client::new();
    let response = client
        .get(format!("http://localhost:{}/health", port))
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .map_err(|e| format!("OAuth proxy not available: {}", e))?;

    Ok(response.status().is_success())
}

pub async fn handle_oauth_callback(_app: tauri::AppHandle, url: String) {
    use url::Url;

    println!("Received OAuth callback: {}", url);

    if let Ok(parsed_url) = Url::parse(&url) {
        let query_params: std::collections::HashMap<String, String> = parsed_url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();

        if let (Some(access_token), Some(refresh_token)) = (
            query_params.get("access_token"),
            query_params.get("refresh_token")
        ) {
            let tokens = GmailTokens {
                access_token: access_token.clone(),
                refresh_token: refresh_token.clone(),
                expiry_date: query_params.get("expiry_date")
                    .and_then(|d| d.parse::<u64>().ok()),
            };

            // Save tokens
            if let Err(e) = save_gmail_tokens(tokens) {
                eprintln!("Failed to save Gmail tokens: {}", e);
                return;
            }

            // Start the Gmail MCP server immediately
            // let app_clone = app.clone();
            // tauri::async_runtime::spawn(async move {
            //     if let Err(e) = mcp::start_gmail_mcp_server(app_clone).await {
            //         eprintln!("Failed to start Gmail MCP server: {}", e);
            //     }
            // });
            // TODO: reuse mcp::run_mcp_server_in_sandbox

            println!("Gmail authentication completed successfully!");
        } else if let Some(error) = query_params.get("error") {
            eprintln!("OAuth error: {}", error);
        }
    }
}
