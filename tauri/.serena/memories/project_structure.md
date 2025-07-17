# Project Structure

## Root Directory
```
/
├── src/                    # React frontend source
│   ├── App.tsx            # Main React component
│   ├── main.tsx           # Entry point
│   └── styles.css         # Global styles
├── src-tauri/             # Tauri backend (Rust)
│   ├── src/
│   │   ├── lib.rs        # Main Tauri application logic
│   │   └── main.rs       # Entry point
│   ├── Cargo.toml        # Rust dependencies
│   ├── tauri.conf.json   # Tauri configuration
│   └── capabilities/     # Tauri capabilities config
├── backend/               # Node.js backend services (planned)
│   ├── ai-connector/     # AI integration services
│   ├── context-manager/  # LLM context management
│   ├── gateway/          # Middleware for LLM/MCP
│   └── sandbox/          # MCP server sandboxing
├── sidecar-server/       # Express.js sidecar
│   └── hello-server.js   # Simple echo server
├── public/               # Static assets
├── package.json          # Frontend dependencies
├── tsconfig.json         # TypeScript config
├── vite.config.ts        # Vite bundler config
└── pnpm-lock.yaml       # Lock file
```

## Key Features
- Desktop app built with Tauri (Rust + Web technologies)
- React frontend with TypeScript
- Sidecar architecture for additional services
- MCP server integration with sandboxing
- Ollama LLM integration