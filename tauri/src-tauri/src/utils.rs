// use std::sync::Mutex;

// pub struct PortState(pub Mutex<u16>);

pub fn get_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub fn load_dotenv_file() -> Result<(), String> {
    let env_path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?
        .join(".env");

    // copy .env.example to .env as a starting point if .env doesn't exist
    if !env_path.exists() {
        println!("No .env file found at {:?}", env_path);

        std::fs::copy(".env.example", ".env").map_err(|e| format!("Failed to copy .env.example to .env: {}", e))?;

        println!("No .env file found at {:?}, copying .env.example to .env", env_path);
    }

    // Load the .env file
    dotenv::from_path(&env_path)
        .map_err(|e| format!("Failed to load .env file: {}", e))?;

    Ok(())
}
