# Tauri + React + Typescript

## Running things

```bash
pnpm install
pnpm tauri dev
```

### Layout

- `backend/`
  - `ai-connector` - "AI connector" -- how our desktop app can connect with various LLMs
  - `context-manager` - Responsible for things like storing history, managing LLM contexts, etc
  - `gateway` - "middleware" between LLMs and MCP server processes
  - `sandbox` - responsible for running MCP server processes in a safe/"sandboxed" environment
- `src` + `public` - "frontend"
