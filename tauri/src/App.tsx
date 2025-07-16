import { useState, useEffect } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
// import { invoke } from "@tauri-apps/api/core";
import { Command } from '@tauri-apps/plugin-shell';
import "./App.css";

function App() {
  const [greetingMessage, setGreetingMessage] = useState("");
  const [greetingMessageError, setGreetingMessageError] = useState("");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
  // const [sidecarMsg, setSidecarMsg] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: string, content: string}[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [mcpServerPackage, setMcpServerPackage] = useState("@modelcontextprotocol/server-github");
  const [mcpServerArgs, setMcpServerArgs] = useState("");
  const [mcpServerStatus, setMcpServerStatus] = useState("");
  const [mcpServerLoading, setMcpServerLoading] = useState(false);

  // Fetch the port from Rust on mount
  useEffect(() => {
    invoke<number>("get_hello_server_port").then(setSidecarPort);
  }, []);

  // async function greet() {
  //   // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  //   setGreetMsg(await invoke("greet", { name }));
  // }

  async function greetingFromNodeSidecarServer() {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:${sidecarPort}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: name }),
      });
      const data = await response.json();
      if (response.ok) {
        setGreetingMessage(data.message);
      } else {
        setGreetingMessageError(data.message);
      }
    } catch (error) {
      setGreetingMessageError(error instanceof Error ? error.message : 'An unknown error occurred');
    }

    setLoading(false);
  }

  async function runOllamaServe() {
    try {
      setOllamaStatus("Starting Ollama server...");
      console.log("Attempting to start Ollama sidecar...");

      const command = Command.sidecar('binaries/ollama-darwin/ollama', ['serve']);
      console.log("Command created, executing...");

      const output = await command.execute();
      console.log("Command executed, output:", output);

      if (output.code === 0) {
        setOllamaStatus(`Ollama server started successfully. stdout: ${output.stdout}`);
      } else {
        setOllamaStatus(`Ollama server failed with code ${output.code}. stderr: ${output.stderr}, stdout: ${output.stdout}`);
      }
    } catch (error) {
      console.error("Error in runOllamaServe:", error);
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      setOllamaStatus(`Error starting Ollama: ${errorMsg}`);
    }
  }

  async function sendChatMessage() {
    if (!chatMessage.trim()) return;

    setChatLoading(true);
    const userMessage = { role: "user", content: chatMessage };
    setChatHistory(prev => [...prev, userMessage]);
    setChatMessage("");

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "llama3.2",
          prompt: chatMessage,
          stream: false
        })
      });

      const data = await response.json();

      if (response.ok) {
        const aiMessage = { role: "assistant", content: data.response };
        setChatHistory(prev => [...prev, aiMessage]);
      } else {
        const errorMessage = { role: "error", content: `Error: ${response.status} - ${response.statusText}` };
        setChatHistory(prev => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      const errorMessage = { role: "error", content: `Error: ${errorMsg}` };
      setChatHistory(prev => [...prev, errorMessage]);
    }

    setChatLoading(false);
  }

  async function runMcpServer() {
    setMcpServerLoading(true);
    setMcpServerStatus("Starting MCP server in sandbox...");

    try {
      const args = mcpServerArgs.trim() ? mcpServerArgs.split(' ').filter(arg => arg.trim()) : [];
      const result = await invoke("run_mcp_server_in_sandbox", {
        config: {
          package_name: mcpServerPackage,
          args: args
        }
      });

      setMcpServerStatus(`MCP server result: ${result}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      setMcpServerStatus(`Error running MCP server: ${errorMsg}`);
    }

    setMcpServerLoading(false);
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://reactjs.org" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greetingFromNodeSidecarServer();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter your name..."
        />
        {/* Port is now set automatically from Rust */}
        <button type="submit" disabled={loading || sidecarPort === null}>
          {loading ? "Loading..." : "Greet"}
        </button>
      </form>
      <p>hello-server port: {sidecarPort ?? 'loading...'}</p>
      <p>node.js server response: {greetingMessage}</p>
      <p>node.js server error: {greetingMessageError}</p>

      <div className="row">
        <button onClick={runOllamaServe}>
          Start Ollama Server
        </button>
      </div>
      <p>Ollama status: {ollamaStatus}</p>

      <div className="chat-section">
        <h3>Chat with Ollama</h3>
        <div className="chat-history" style={{border: '1px solid #ccc', padding: '10px', height: '200px', overflowY: 'scroll', marginBottom: '10px'}}>
          {chatHistory.map((msg, index) => (
            <div key={index} style={{marginBottom: '8px'}}>
              <strong>{msg.role}:</strong> {msg.content}
            </div>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            sendChatMessage();
          }}
        >
          <input
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder="Type your message..."
            disabled={chatLoading}
          />
          <button type="submit" disabled={chatLoading || !chatMessage.trim()}>
            {chatLoading ? "Sending..." : "Send"}
          </button>
                </form>
      </div>

      <div className="mcp-server-section">
        <h3>Run MCP Server in Sandbox</h3>
        <div className="row">
          <input
            value={mcpServerPackage}
            onChange={(e) => setMcpServerPackage(e.target.value)}
            placeholder="MCP Server Package (e.g., @modelcontextprotocol/server-github)"
            style={{flex: 1, marginRight: '10px'}}
          />
          <input
            value={mcpServerArgs}
            onChange={(e) => setMcpServerArgs(e.target.value)}
            placeholder="Optional arguments (space-separated)"
            style={{flex: 1}}
          />
        </div>
        <div className="row" style={{marginTop: '10px'}}>
          <button
            onClick={runMcpServer}
            disabled={mcpServerLoading || !mcpServerPackage.trim()}
            style={{flex: 1}}
          >
            {mcpServerLoading ? "Running..." : "Run MCP Server"}
          </button>
        </div>
        <p>MCP Server Status: {mcpServerStatus}</p>
      </div>

    </main>
  );
}

export default App;
