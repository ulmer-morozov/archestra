import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [ollamaPort, setOllamaPort] = useState<number | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [isOllamaRunning, setIsOllamaRunning] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<
    { role: string; content: string }[]
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<{
    [key: string]: { command: string; args: string[] };
  }>({
    github: {
      command: "env",
      args: [
        "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_my_token",
        "npx",
        "-y",
        "@modelcontextprotocol/server-github",
      ],
    },
    "browser-tools": {
      command: "npx",
      args: ["@agentdeskai/browser-tools-mcp"],
    },
    context7: {
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    },
  });
  const [currentServerName, setCurrentServerName] = useState("");
  const [currentServerCommand, setCurrentServerCommand] = useState("env");
  const [currentServerArgs, setCurrentServerArgs] = useState("");
  const [jsonImport, setJsonImport] = useState("");
  const [mcpServerStatus, setMcpServerStatus] = useState<{
    [key: string]: string;
  }>({});
  const [mcpServerLoading, setMcpServerLoading] = useState<{
    [key: string]: boolean;
  }>({});
  const [activeSection, setActiveSection] = useState<"none" | "import" | "add">(
    "none",
  );

  const serverListRef = useRef<HTMLDivElement>(null);


  async function runOllamaServe() {
    console.log("runOllamaServe called, isOllamaRunning:", isOllamaRunning);

    // Prevent multiple starts
    if (isOllamaRunning) {
      setOllamaStatus("Ollama server is already running");
      return;
    }

    try {
      setOllamaStatus("Starting Ollama server...");
      const port = await invoke<number>("start_ollama_server");
      setOllamaPort(port);
      setIsOllamaRunning(true);
      setOllamaStatus(`Ollama server started successfully on port ${port}`);
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      setOllamaStatus(`Error starting Ollama: ${errorMsg}`);
      setIsOllamaRunning(false);
      console.error("Error starting Ollama:", error);
    }
  }

  async function stopOllamaServe() {
    setOllamaStatus("Stopping Ollama server...");

    try {
      await invoke("stop_ollama_server");
      setIsOllamaRunning(false);
      setOllamaPort(null);
      setOllamaStatus("Ollama server stopped");
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : JSON.stringify(error);
      setOllamaStatus(`Error stopping Ollama: ${errorMsg}`);
      console.error("Error stopping Ollama:", error);
      setIsOllamaRunning(false);
      setOllamaPort(null);
    }
  }

  async function sendChatMessage() {
    if (!chatMessage.trim() || !ollamaPort) return;

    setChatLoading(true);
    const userMessage = { role: "user", content: chatMessage };
    setChatHistory((prev) => [...prev, userMessage]);
    setChatMessage("");

    try {
      const response = await fetch(`http://localhost:${ollamaPort}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          prompt: chatMessage,
          stream: false,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const aiMessage = { role: "assistant", content: data.response };
        setChatHistory((prev) => [...prev, aiMessage]);
      } else {
        const errorMessage = {
          role: "error",
          content: `Error: ${response.status} - ${response.statusText}`,
        };
        setChatHistory((prev) => [...prev, errorMessage]);
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "An unknown error occurred";
      const errorMessage = { role: "error", content: `Error: ${errorMsg}` };
      setChatHistory((prev) => [...prev, errorMessage]);
    }

    setChatLoading(false);
  }

  async function addMcpServer() {
    if (!currentServerName.trim()) {
      alert("Please enter a server name");
      return;
    }

    const args = currentServerArgs.trim()
      ? currentServerArgs.split(" ").filter((arg) => arg.trim())
      : [];

    setMcpServers((prev) => ({
      ...prev,
      [currentServerName]: {
        command: currentServerCommand,
        args: args,
      },
    }));

    setCurrentServerName("");
    setCurrentServerArgs("");
    setActiveSection("none");

    // Scroll to the server list to show the newly added server
    setTimeout(() => {
      if (serverListRef.current) {
        serverListRef.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }
    }, 100);
  }

  async function runMcpServer(serverName: string) {
    setMcpServerLoading((prev) => ({ ...prev, [serverName]: true }));
    setMcpServerStatus((prev) => ({
      ...prev,
      [serverName]: "Starting MCP server in sandbox...",
    }));

    try {
      const server = mcpServers[serverName];
      const result = await invoke("run_mcp_server_in_sandbox", {
        serverName: serverName,
        config: {
          command: server.command,
          args: server.args,
        },
      });

      setMcpServerStatus((prev) => ({
        ...prev,
        [serverName]: `MCP server result: ${result}`,
      }));
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "An unknown error occurred";
      setMcpServerStatus((prev) => ({
        ...prev,
        [serverName]: `Error: ${errorMsg}`,
      }));
    }

    setMcpServerLoading((prev) => ({ ...prev, [serverName]: false }));
  }

  async function removeMcpServer(serverName: string) {
    setMcpServers((prev) => {
      const newServers = { ...prev };
      delete newServers[serverName];
      return newServers;
    });

    setMcpServerStatus((prev) => {
      const newStatus = { ...prev };
      delete newStatus[serverName];
      return newStatus;
    });

    setMcpServerLoading((prev) => {
      const newLoading = { ...prev };
      delete newLoading[serverName];
      return newLoading;
    });
  }

  function importFromJson() {
    try {
      const parsed = JSON.parse(jsonImport);
      let serversToImport: {
        [key: string]: { command: string; args: string[] };
      } = {};

      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        serversToImport = parsed.mcpServers;
      } else if (typeof parsed === "object") {
        serversToImport = parsed;
      } else {
        throw new Error("Invalid JSON format");
      }

      const validServers: {
        [key: string]: { command: string; args: string[] };
      } = {};
      Object.entries(serversToImport).forEach(([name, config]) => {
        if (
          typeof config === "object" &&
          "command" in config &&
          "args" in config &&
          Array.isArray(config.args)
        ) {
          validServers[name] = {
            command: config.command,
            args: config.args,
          };
        }
      });

      if (Object.keys(validServers).length > 0) {
        setMcpServers((prev) => ({
          ...prev,
          ...validServers,
        }));
        setJsonImport("");
        setActiveSection("none");
        alert(
          `Successfully imported ${
            Object.keys(validServers).length
          } server(s)!`,
        );

        // Scroll to the server list to show the newly imported servers
        setTimeout(() => {
          if (serverListRef.current) {
            serverListRef.current.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        }, 100);
      } else {
        alert("No valid servers found in the JSON");
      }
    } catch (error) {
      alert(
        `Error importing JSON: ${
          error instanceof Error ? error.message : "Invalid JSON"
        }`,
      );
    }
  }

  return (
    <main className="container">
      <div className="header">
        <h1>archestra.ai</h1>
        <div className="logo-row">
          <a href="https://vitejs.dev" target="_blank">
            <img src="/vite.svg" className="logo vite" alt="Vite logo" />
          </a>
        </div>
      </div>


      <div className="card">
        <h3>Ollama Local AI</h3>
        <div className="form-row">
          {!isOllamaRunning ? (
            <button onClick={runOllamaServe}>Start Ollama Server</button>
          ) : (
            <button onClick={stopOllamaServe} className="button-danger">
              Stop Ollama Server
            </button>
          )}
        </div>

        {ollamaStatus && (
          <div
            className={`status-text ${
              ollamaStatus.includes("Error")
                ? "status-error"
                : ollamaStatus.includes("successfully")
                ? "status-success"
                : ""
            }`}
          >
            {ollamaStatus}
          </div>
        )}
        {ollamaPort && (
          <div className="status-text status-success">
            Ollama running on port: {ollamaPort}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Chat with Ollama</h3>
        <div className="chat-history">
          {chatHistory.map((msg, index) => (
            <div key={index} className={`chat-message ${msg.role}`}>
              <div className="role">{msg.role}</div>
              <div>{msg.content}</div>
            </div>
          ))}
        </div>
        <form
          className="form-row"
          onSubmit={(e) => {
            e.preventDefault();
            sendChatMessage();
          }}
        >
          <input
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder={ollamaPort ? "Type your message..." : "Start Ollama server first..."}
            disabled={chatLoading || !ollamaPort}
            style={{ flex: 1 }}
          />
          <button type="submit" disabled={chatLoading || !chatMessage.trim() || !ollamaPort}>
            {chatLoading ? "Sending..." : "Send"}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>MCP Servers Configuration</h3>

        <div className="action-buttons">
          <button
            className={`action-button ${
              activeSection === "import" ? "active" : ""
            }`}
            onClick={() =>
              setActiveSection(activeSection === "import" ? "none" : "import")
            }
          >
            Import JSON
          </button>
          <button
            className={`action-button ${
              activeSection === "add" ? "active" : ""
            }`}
            onClick={() =>
              setActiveSection(activeSection === "add" ? "none" : "add")
            }
          >
            Add New MCP
          </button>
        </div>

        {activeSection === "import" && (
          <div className="import-section">
            <div className="collapsible-content">
              <h4>Import from JSON</h4>
              <textarea
                value={jsonImport}
                onChange={(e) => setJsonImport(e.target.value)}
                placeholder={`Paste MCP JSON configuration, e.g.:
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}`}
                className="import-textarea"
              />
              <div className="form-row">
                <button onClick={importFromJson} disabled={!jsonImport.trim()}>
                  Import Servers
                </button>
              </div>
            </div>
          </div>
        )}

        {activeSection === "add" && (
          <div className="add-server-section">
            <div className="collapsible-content">
              <h4>Add New MCP Server</h4>
              <div className="form-group">
                <label>Server Name</label>
                <input
                  value={currentServerName}
                  onChange={(e) => setCurrentServerName(e.target.value)}
                  placeholder="e.g., github, context7, browser-tools"
                />
              </div>

              <div className="form-row-responsive">
                <input
                  value={currentServerArgs}
                  onChange={(e) => setCurrentServerArgs(e.target.value)}
                  placeholder="Arguments (e.g., GITHUB_PERSONAL_ACCESS_TOKEN=token npx -y @modelcontextprotocol/server-github)"
                />
                <select
                  value={currentServerCommand}
                  onChange={(e) => setCurrentServerCommand(e.target.value)}
                >
                  <option value="env">env</option>
                  <option value="npx">npx</option>
                  <option value="node">node</option>
                </select>
              </div>

              <div className="form-row">
                <button
                  onClick={addMcpServer}
                  disabled={!currentServerName.trim()}
                >
                  Add Server Configuration
                </button>
              </div>
            </div>
          </div>
        )}

        <div>
          <h4>Configured MCP Servers</h4>
          {Object.entries(mcpServers).length === 0 ? (
            <div className="status-text">No servers configured yet.</div>
          ) : (
            <div className="server-list" ref={serverListRef}>
              {Object.entries(mcpServers).map(([name, config]) => (
                <div key={name} className="server-card">
                  <div className="server-header">
                    <div className="server-info">
                      <h4>{name}</h4>
                      <div className="server-details">
                        Command: {config.command}
                        <br />
                        Args: {config.args.join(" ")}
                      </div>
                    </div>
                    <div className="server-actions">
                      <button
                        onClick={() => runMcpServer(name)}
                        disabled={mcpServerLoading[name]}
                      >
                        {mcpServerLoading[name] ? "Running..." : "Run"}
                      </button>
                      <button
                        onClick={() => removeMcpServer(name)}
                        disabled={mcpServerLoading[name]}
                        className="button-danger"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {mcpServerStatus[name] && (
                    <div
                      className={`status-text ${
                        mcpServerStatus[name].includes("Error")
                          ? "status-error"
                          : mcpServerStatus[name].includes("result")
                          ? "status-success"
                          : ""
                      }`}
                    >
                      {mcpServerStatus[name]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
