import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import MCPCatalogs from "./components/MCPCatalogs";
import "./App.css";

function App() {
  const [ollamaPort, setOllamaPort] = useState<number | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [isOllamaRunning, setIsOllamaRunning] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<
    { role: string; content: string }[]
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<{
    [key: string]: { command: string; args: string[] };
  }>({});
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
  const [mcpTools, setMcpTools] = useState<
    Array<{
      serverName: string;
      tool: {
        name: string;
        description?: string;
        input_schema: any;
      };
    }>
  >([]);
  const [mcpServerStatuses, setMcpServerStatuses] = useState<{
    [key: string]: boolean;
  }>({});
  const [activeTab, setActiveTab] = useState<"chat" | "mcp">("chat");
  const [debugInfo, setDebugInfo] = useState<string>("");

  const serverListRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMcpServersFromDb();

    // Set up periodic refresh of MCP tools for automatic discovery
    const interval = setInterval(() => {
      loadMcpTools();
      loadMcpServerStatuses();
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, []);

  async function loadMcpServersFromDb() {
    try {
      const servers = await invoke<{
        [key: string]: { command: string; args: string[] };
      }>("load_mcp_servers");
      setMcpServers(servers);

      // Also load MCP tools and server statuses
      await loadMcpTools();
      await loadMcpServerStatuses();
    } catch (error) {
      console.error("Failed to load MCP servers:", error);
    }
  }

  async function loadMcpTools() {
    try {
      const tools = await invoke<
        Array<
          [
            string,
            {
              name: string;
              description?: string;
              input_schema: any;
            },
          ]
        >
      >("get_mcp_tools");

      const formattedTools = tools.map(([serverName, tool]) => ({
        serverName,
        tool,
      }));
      setMcpTools(formattedTools);
    } catch (error) {
      console.error("Failed to load MCP tools:", error);
    }
  }

  async function loadMcpServerStatuses() {
    try {
      const statuses = await invoke<{
        [key: string]: boolean;
      }>("get_mcp_server_status");
      setMcpServerStatuses(statuses);
    } catch (error) {
      console.error("Failed to load MCP server statuses:", error);
    }
  }

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

      // Wait a moment for the server to start, then fetch available models and start MCP servers
      setTimeout(() => {
        fetchAvailableModels(port);
        autoStartMcpServers();
      }, 2000);
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

  async function fetchAvailableModels(port: number) {
    try {
      const response = await fetch(`http://localhost:${port}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map((model: any) => model.name) || [];

        setAvailableModels(models);

        if (models.length > 0 && !selectedModel) {
          setSelectedModel(models[0]);
        }
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  }

  async function sendChatMessage() {
    if (!chatMessage.trim() || !ollamaPort) return;

    setChatLoading(true);
    const userMessage = { role: "user", content: chatMessage };
    setChatHistory((prev) => [...prev, userMessage]);
    const currentMessage = chatMessage;
    setChatMessage("");

    try {
      // Check if the model supports tool calling
      const modelSupportsTools =
        selectedModel &&
        (selectedModel.includes("functionary") ||
          selectedModel.includes("mistral") ||
          selectedModel.includes("command") ||
          selectedModel.includes("qwen") ||
          selectedModel.includes("hermes"));

      if (mcpTools.length > 0 && modelSupportsTools) {
        // Use the enhanced tool-enabled chat
        const messages = [
          { role: "user", content: currentMessage, tool_calls: null },
        ];

        const response = await invoke<any>("ollama_chat_with_tools", {
          port: ollamaPort,
          model: selectedModel,
          messages: messages,
        });

        console.log("Tool-enabled response:", response);

        if (response.tool_results && response.tool_results.length > 0) {
          // Add tool execution results to chat history
          for (const toolResult of response.tool_results) {
            const toolMessage = {
              role: "tool",
              content: `Tool executed: ${toolResult.content}`,
            };
            setChatHistory((prev) => [...prev, toolMessage]);
          }
        }

        if (response.message && response.message.content) {
          const aiMessage = {
            role: "assistant",
            content: response.message.content,
          };
          setChatHistory((prev) => [...prev, aiMessage]);
        }
      } else {
        // Add warning if tools are available but model doesn't support them
        if (mcpTools.length > 0 && !modelSupportsTools) {
          const warningMessage = {
            role: "system",
            content: `⚠️ MCP tools are available but ${selectedModel} doesn't support tool calling. Consider using functionary-small-v3.2 or another tool-enabled model.`,
          };
          setChatHistory((prev) => [...prev, warningMessage]);
        }

        // Use regular Ollama chat
        const response = await fetch(
          `http://localhost:${ollamaPort}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: selectedModel,
              prompt: currentMessage,
              stream: false,
            }),
          },
        );

        const responseText = await response.text();
        console.log("Raw response:", responseText);

        let data;
        try {
          data = JSON.parse(responseText);
          console.log("Parsed response:", data);
        } catch (parseError) {
          console.error("Failed to parse response:", parseError);
          throw new Error(`Failed to parse response: ${responseText}`);
        }

        if (response.ok) {
          const aiMessage = { role: "assistant", content: data.response };
          setChatHistory((prev) => [...prev, aiMessage]);
        } else {
          const errorMessage = {
            role: "error",
            content: `Error: ${response.status} - ${
              response.statusText
            } - ${JSON.stringify(data)}`,
          };
          setChatHistory((prev) => [...prev, errorMessage]);
        }
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "An unknown error occurred";
      const errorMessage = { role: "error", content: `Error: ${errorMsg}` };
      setChatHistory((prev) => [...prev, errorMessage]);
    }

    setChatLoading(false);
  }

  async function autoStartMcpServers() {
    console.log("Auto-starting MCP servers...");

    // Start all configured MCP servers
    for (const [serverName, config] of Object.entries(mcpServers)) {
      try {
        console.log(`Auto-starting MCP server: ${serverName}`);
        await invoke("start_persistent_mcp_server", {
          name: serverName,
          command: config.command,
          args: config.args,
        });

        setMcpServerStatus((prev) => ({
          ...prev,
          [serverName]: "Auto-started with persistent connection",
        }));
      } catch (error) {
        console.error(`Failed to auto-start MCP server ${serverName}:`, error);
        setMcpServerStatus((prev) => ({
          ...prev,
          [serverName]: `Auto-start failed: ${error}`,
        }));
      }
    }

    // Refresh tools and statuses after starting servers
    setTimeout(() => {
      loadMcpTools();
      loadMcpServerStatuses();
    }, 3000);
  }

  async function debugMcpBridge() {
    try {
      const debug = await invoke<string>("debug_mcp_bridge");
      setDebugInfo(debug);

      // Scroll to debug section after setting info
      setTimeout(() => {
        if (debugRef.current) {
          debugRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 100);
    } catch (error) {
      console.error("Failed to debug MCP bridge:", error);
      setDebugInfo(`Error: ${error}`);

      // Still scroll to show the error
      setTimeout(() => {
        if (debugRef.current) {
          debugRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 100);
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

      <div className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          Chat with AI
        </button>
        <button
          className={`nav-tab ${activeTab === "mcp" ? "active" : ""}`}
          onClick={() => setActiveTab("mcp")}
        >
          MCP Catalogs
        </button>
      </div>

      {activeTab === "chat" && (
        <>
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
              <button onClick={debugMcpBridge}>Debug MCP Bridge</button>
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
            {ollamaPort && availableModels.length > 0 && (
              <div className="form-row">
                <label>Model:</label>
                <select
                  value={selectedModel || ""}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  {availableModels.map((model) => {
                    const supportsTools =
                      model.includes("functionary") ||
                      model.includes("mistral") ||
                      model.includes("command") ||
                      model.includes("qwen") ||
                      model.includes("hermes");

                    return (
                      <option key={model} value={model}>
                        {model}{" "}
                        {supportsTools && mcpTools.length > 0 ? "✅" : ""}
                      </option>
                    );
                  })}
                </select>
                {mcpTools.length > 0 && (
                  <span
                    style={{
                      marginLeft: "10px",
                      fontSize: "0.9em",
                      color: "#718096",
                    }}
                  >
                    {mcpTools.length} MCP tool{mcpTools.length !== 1 ? "s" : ""}{" "}
                    available
                  </span>
                )}
              </div>
            )}
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
                placeholder={
                  ollamaPort
                    ? "Type your message..."
                    : "Start Ollama server first..."
                }
                disabled={chatLoading || !ollamaPort}
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                disabled={chatLoading || !chatMessage.trim() || !ollamaPort}
              >
                {chatLoading ? "Sending..." : "Send"}
              </button>
            </form>
          </div>

          {debugInfo && (
            <div className="card" ref={debugRef}>
              <h4>MCP Bridge Debug Info</h4>
              <pre
                style={{
                  background: "#2d3748",
                  color: "#e2e8f0",
                  padding: "15px",
                  borderRadius: "8px",
                  overflow: "auto",
                  fontSize: "14px",
                  lineHeight: "1.4",
                  border: "1px solid #4a5568",
                }}
              >
                {debugInfo}
              </pre>
            </div>
          )}
        </>
      )}

      {activeTab === "mcp" && (
        <MCPCatalogs
          mcpServers={mcpServers}
          setMcpServers={setMcpServers}
          mcpServerStatus={mcpServerStatus}
          setMcpServerStatus={setMcpServerStatus}
          mcpServerLoading={mcpServerLoading}
          setMcpServerLoading={setMcpServerLoading}
          mcpServerStatuses={mcpServerStatuses}
        />
      )}
    </main>
  );
}

export default App;