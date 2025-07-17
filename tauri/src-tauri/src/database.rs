use rusqlite::{Connection, Result};
use std::path::Path;

pub fn get_database_connection() -> Result<Connection> {
    let db_path = Path::new("mcp_servers.db");
    let conn = Connection::open(db_path)?;
    Ok(conn)
}

pub fn init_database() -> Result<Connection> {
    let conn = get_database_connection()?;

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
