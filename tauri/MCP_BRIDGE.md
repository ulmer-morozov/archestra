# MCP Bridge Documentation

## Overview

The MCP (Model Context Protocol) Bridge is a Rust-based component that enables seamless communication between Ollama LLMs and MCP servers running in sandboxed environments. This bridge allows local AI models to discover and utilize external tools through the standardized Model Context Protocol.

## Architecture

### Core Components

1. **MCP Bridge (`mcp_bridge.rs`)**: The main orchestration component
2. **MCP Servers**: External processes providing tools and resources
3. **Ollama Integration**: Tool-enhanced chat functionality
4. **Sandbox Environment**: macOS `sandbox-exec` for security

### Data Flow

```
User → Frontend → Tauri Backend → MCP Bridge
                                      ↓
                               MCP Server (Sandboxed)
                                      ↓
                               Tool Discovery
                                      ↓
                               Ollama Integration
```

## MCP Communication Protocol

### 1. Server Lifecycle

#### Starting a Server
```rust
// Server starts in sandbox with persistent connection
start_mcp_server(name, command, args)
  → Spawn sandboxed process
  → Create stdin/stdout channels
  → Initialize response buffer
  → Store server instance
```

#### Server State Management
- **stdin_tx**: Channel sender for sending requests to MCP server
- **response_buffer**: Shared buffer for storing server responses
- **is_running**: Server health status

### 2. MCP Protocol Handshake

The MCP protocol requires a specific initialization sequence:

#### Step 1: Initialize Request
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {}
    },
    "clientInfo": {
      "name": "archestra-mcp-bridge",
      "version": "0.1.0"
    }
  }
}
```

#### Step 2: Initialize Response
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": {
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "ServerName",
      "version": "1.0.0"
    }
  }
}
```

#### Step 3: Initialized Notification
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "method": "notifications/initialized",
  "params": null
}
```

### 3. Tool Discovery

After initialization, the bridge discovers available tools:

#### Tools List Request
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "method": "tools/list",
  "params": null
}
```

#### Tools List Response
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "result": {
    "tools": [
      {
        "name": "tool_name",
        "description": "Tool description",
        "inputSchema": {
          "type": "object",
          "properties": {...}
        }
      }
    ]
  }
}
```

### 4. Tool Execution

#### Tool Call Request
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {...}
  }
}
```

#### Tool Call Response
```json
{
  "jsonrpc": "2.0",
  "id": "uuid-here",
  "result": {
    "content": "Tool execution result"
  }
}
```

## Implementation Details

### Channel-Based Communication

The bridge uses Tokio channels to handle async communication without blocking:

```rust
// Stdin handling
let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(100);
tokio::spawn(async move {
    while let Some(message) = stdin_rx.recv().await {
        stdin.write_all(message.as_bytes()).await?;
        stdin.flush().await?;
    }
});

// Response buffer for stdout
let response_buffer = Arc<Mutex<VecDeque<String>>>;
```

### Request-Response Matching

Responses are matched to requests using JSON-RPC `id` field:

```rust
async fn send_request_and_wait(&self, server_name: &str, request: &JsonRpcRequest) -> Result<JsonRpcResponse, String> {
    self.send_request(server_name, request).await?;
    
    // Poll response buffer until matching ID found or timeout
    while start_time.elapsed() < timeout_duration {
        let mut buffer = response_buffer.lock().unwrap();
        while let Some(line) = buffer.pop_front() {
            if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                if response.id == request.id {
                    return Ok(response);
                }
            }
        }
    }
}
```

### Ollama Integration

The bridge integrates with Ollama by:

1. **Tool Registration**: Converting MCP tools to Ollama function format
2. **Request Enhancement**: Adding available tools to Ollama chat requests
3. **Tool Execution**: Routing Ollama tool calls to appropriate MCP servers
4. **Response Integration**: Returning tool results to Ollama for final response

```rust
// Convert MCP tools to Ollama format
for (server_name, tool) in available_tools {
    ollama_tools.push(json!({
        "type": "function",
        "function": {
            "name": format!("{}_{}", server_name, tool.name),
            "description": tool.description,
            "parameters": tool.input_schema
        }
    }));
}
```

## Security Considerations

### Sandboxing
- All MCP servers run in macOS `sandbox-exec` environment
- Currently using permissive profile for development
- Production should use restrictive profiles

### Process Isolation
- Each MCP server runs as separate process
- Communication only through controlled stdio channels
- No direct memory sharing between processes
- Async-safe process management using Tokio mutexes

## Health Monitoring

The bridge includes automatic health monitoring:

```rust
async fn start_health_monitor(&self, server_name: &str) {
    loop {
        tokio::time::sleep(Duration::from_secs(30)).await;
        // Check if server is still running
        // Log health status
        // Restart if needed (future enhancement)
    }
}
```

## Troubleshooting

### Common Issues

1. **"Request timed out"**
   - Server may not be responding to JSON-RPC requests
   - Check if server supports stdio transport
   - Verify initialization sequence

2. **"No tools discovered"**
   - Server may not have completed initialization
   - Tools list response may be in different format
   - Check server logs for errors

3. **Tool execution fails**
   - Verify tool name and arguments match schema
   - Check server supports tool execution
   - Review sandboxing permissions

### Debugging

Use the "Debug MCP Bridge" button to see:
- Current MCP servers and their status
- Discovered tools for each server
- Active connections

Check terminal logs for:
- Server initialization messages
- Request/response JSON
- Error messages from MCP servers

## Future Enhancements

1. **Persistent Tool Storage**: Cache discovered tools in SQLite
2. **Auto-Restart**: Automatic server restart on failure
3. **Tool Filtering**: UI to enable/disable specific tools
4. **Response Streaming**: Support for streaming tool responses
5. **Better Error Recovery**: Graceful handling of server crashes
6. **Tool Usage Analytics**: Track which tools are used most

## Example MCP Servers

### Context7 (Documentation)
```json
{
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"]
}
```

### GitHub
```json
{
  "command": "env",
  "args": ["GITHUB_PERSONAL_ACCESS_TOKEN=token", "npx", "-y", "@modelcontextprotocol/server-github"]
}
```

### Filesystem
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/directory"]
}
```