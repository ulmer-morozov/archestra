# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `pnpm install` - Install dependencies
- `pnpm tauri dev` - Run development server with hot reload
- `pnpm dev` - Run frontend development server only
- `pnpm build` - Build TypeScript and frontend
- `pnpm tauri build` - Build the complete Tauri application

### TypeScript/Frontend
- `tsc` - TypeScript compilation
- Uses Vite for frontend bundling
- React with TypeScript for the UI

### Rust/Backend
- Located in `src-tauri/`
- Uses standard Cargo commands: `cargo build`, `cargo run`, `cargo test`
- Database initialization happens automatically on app startup

## Architecture Overview

This is a Tauri desktop application that serves as a management interface for AI services and MCP (Model Context Protocol) servers. The architecture consists of:

### Frontend (React/TypeScript)
- **Entry point**: `src/App.tsx` - Main application component
- **Build system**: Vite with React plugin
- **UI**: Single-page application with sections for Ollama chat and MCP server management

### Backend (Rust/Tauri)
- **Entry point**: `src-tauri/src/main.rs` calls `lib.rs::run()`
- **Core modules**:
  - `ollama.rs` - Manages Ollama server lifecycle (start/stop as sidecar process)
  - `mcp.rs` - Handles MCP server management, sandboxing, and database operations
  - `database.rs` - SQLite database operations for persistent MCP server storage
  - `utils.rs` - Utility functions including port management

### Key Components

#### Ollama Integration
- Starts/stops Ollama server as a sidecar process on a dynamically allocated port
- Provides chat interface with model selection
- Uses `tauri-plugin-shell` for process management

#### MCP Server Management
- Stores MCP server configurations in SQLite database (`mcp_servers.db`)
- Runs MCP servers in sandboxed environments using `sandbox-exec` profiles
- Supports JSON import/export of server configurations
- Real-time server status tracking and logging

#### Database Schema
```sql
CREATE TABLE mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    command TEXT NOT NULL,
    args TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Security Features
- MCP servers run in sandbox environments with profiles in `sandbox-exec-profiles/`
- Three sandbox profiles: restrictive, permissive, and everything-for-now
- Process isolation for external server execution

### Backend Directory Structure
The `backend/` directory contains modular components:
- `ai-connector` - AI service integration layer
- `context-manager` - LLM context and history management
- `gateway` - Middleware between LLMs and MCP servers
- `sandbox` - Secure MCP server execution environment

### Development Notes
- Frontend communicates with backend via Tauri's invoke system
- Uses `pnpm` as package manager
- Database is automatically initialized on first run
- Ollama binary is bundled in `src-tauri/binaries/`