import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MCPServer {
  command: string;
  args: string[];
}

interface MCPCatalogsProps {
  mcpServers: { [key: string]: MCPServer };
  setMcpServers: React.Dispatch<React.SetStateAction<{ [key: string]: MCPServer }>>;
  mcpServerStatus: { [key: string]: string };
  setMcpServerStatus: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>;
  mcpServerLoading: { [key: string]: boolean };
  setMcpServerLoading: React.Dispatch<React.SetStateAction<{ [key: string]: boolean }>>;
}

export default function MCPCatalogs({
  mcpServers,
  setMcpServers,
  mcpServerStatus,
  setMcpServerStatus,
  mcpServerLoading,
  setMcpServerLoading,
}: MCPCatalogsProps) {
  const [currentServerName, setCurrentServerName] = useState("");
  const [currentServerCommand, setCurrentServerCommand] = useState("env");
  const [currentServerArgs, setCurrentServerArgs] = useState("");
  const [jsonImport, setJsonImport] = useState("");
  const [activeSection, setActiveSection] = useState<"none" | "import" | "add">("none");
  const [showGmailSetup, setShowGmailSetup] = useState(false);
  const [gmailTokens, setGmailTokens] = useState<any>(null);

  const serverListRef = useRef<HTMLDivElement>(null);

  // Check for existing Gmail tokens on component mount
  useEffect(() => {
    checkGmailTokens();

    // Listen for OAuth callback messages
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'GMAIL_AUTH_SUCCESS') {
        handleOAuthSuccess(event.data.tokens);
      }
    };

    window.addEventListener('message', handleMessage);

    // Check for tokens in localStorage (fallback)
    const storedTokens = localStorage.getItem('gmail_tokens');
    if (storedTokens) {
      try {
        const tokens = JSON.parse(storedTokens);
        handleOAuthSuccess(tokens);
        localStorage.removeItem('gmail_tokens'); // Clean up
      } catch (error) {
        console.error('Failed to parse stored tokens:', error);
      }
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  async function checkGmailTokens() {
    try {
      const tokens = await invoke("load_gmail_tokens") as any;
      setGmailTokens(tokens);
    } catch (error) {
      console.error("Failed to load Gmail tokens:", error);
    }
  }

  async function handleOAuthSuccess(tokens: any) {
    try {
      // Save tokens to backend
      await invoke("save_gmail_tokens", { tokens });

      // Update local state
      setGmailTokens(tokens);

      // Add MCP server to the list
      setMcpServers((prev) => ({
        ...prev,
        "Gmail MCP Server": {
          command: "npx",
          args: ["@gongrzhe/server-gmail-autoauth-mcp"],
        },
      }));

      // Close the setup dialog
      setShowGmailSetup(false);

      // Show success message
      alert("Gmail authentication successful! The MCP server has been configured and added to your list.");

    } catch (error) {
      console.error("Failed to save Gmail tokens:", error);
      alert("Failed to save Gmail tokens. Please try again.");
    }
  }

  async function addMcpServer() {
    if (!currentServerName.trim()) {
      alert("Please enter a server name");
      return;
    }

    const args = currentServerArgs.trim()
      ? currentServerArgs.split(" ").filter((arg) => arg.trim())
      : [];

    try {
      await invoke("save_mcp_server", {
        name: currentServerName,
        command: currentServerCommand,
        args: args,
      });

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

      setTimeout(() => {
        if (serverListRef.current) {
          serverListRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      }, 100);
    } catch (error) {
      console.error("Failed to save MCP server:", error);
      alert("Failed to save MCP server. Please try again.");
    }
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
    try {
      await invoke("delete_mcp_server", { name: serverName });

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
    } catch (error) {
      console.error("Failed to delete MCP server:", error);
      alert("Failed to delete MCP server. Please try again.");
    }
  }

  async function importFromJson() {
    try {
      const parsed = JSON.parse(jsonImport);
      let serversToImport: { [key: string]: MCPServer } = {};

      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        serversToImport = parsed.mcpServers;
      } else if (typeof parsed === "object") {
        serversToImport = parsed;
      } else {
        throw new Error("Invalid JSON format");
      }

      const validServers: { [key: string]: MCPServer } = {};
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
        try {
          await Promise.all(
            Object.entries(validServers).map(([name, config]) =>
              invoke("save_mcp_server", {
                name: name,
                command: config.command,
                args: config.args,
              })
            )
          );

          setMcpServers((prev) => ({
            ...prev,
            ...validServers,
          }));
          setJsonImport("");
          setActiveSection("none");
          alert(
            `Successfully imported ${Object.keys(validServers).length} server(s)!`
          );

          setTimeout(() => {
            if (serverListRef.current) {
              serverListRef.current.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              });
            }
          }, 100);
        } catch (saveError) {
          console.error("Failed to save imported servers:", saveError);
          alert("Failed to save imported servers. Please try again.");
        }
      } else {
        alert("No valid servers found in the JSON");
      }
    } catch (error) {
      alert(
        `Error importing JSON: ${
          error instanceof Error ? error.message : "Invalid JSON"
        }`
      );
    }
  }

    async function setupGmailServer() {
    try {
      // Check if OAuth proxy is available
      const proxyHealth = await invoke("check_oauth_proxy_health");

      if (!proxyHealth) {
        alert("OAuth proxy service is not running. Please start the OAuth proxy service first.");
        return;
      }

      // Start OAuth flow
      const authResponse = await invoke("start_gmail_auth") as { auth_url: string };

      // The browser will open automatically and handle the OAuth flow
      // The callback will save tokens and close the setup dialog

    } catch (error) {
      console.error("Failed to start Gmail auth:", error);
      alert("Failed to start Gmail authentication. Please try again.");
    }
  }

  return (
    <div className="mcp-catalogs">
      <div className="card">
        <h3>Featured MCP Servers</h3>
        <div className="featured-servers">
          <div className="server-card featured">
            <div className="server-header">
              <div className="server-info">
                <h4>📧 Gmail MCP Server</h4>
                <p>Access and manage your Gmail messages with AI</p>
                <div className="server-details">
                  <span className="tag">Email Management</span>
                  {gmailTokens ? (
                    <span className="tag" style={{ backgroundColor: '#d4edda', color: '#155724' }}>
                      ✅ Authenticated
                    </span>
                  ) : (
                    <span className="tag">OAuth Required</span>
                  )}
                </div>
              </div>
              <div className="server-actions">
                {gmailTokens ? (
                  <button
                    onClick={() => {
                      setMcpServers((prev) => ({
                        ...prev,
                        "Gmail MCP Server": {
                          command: "npx",
                          args: ["@gongrzhe/server-gmail-autoauth-mcp"],
                        },
                      }));
                    }}
                    className="featured-button"
                    style={{ backgroundColor: '#28a745' }}
                  >
                    Add to MCP
                  </button>
                ) : (
                  <button
                    onClick={() => setShowGmailSetup(true)}
                    className="featured-button"
                  >
                    Setup Gmail
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showGmailSetup && (
        <div className="card">
          <h3>Gmail Authentication</h3>
          <div className="setup-step">
            <p>
              Click the button below to start the Gmail authentication process.
              This will open your browser where you can authorize access to your Gmail account.
            </p>
            <div className="setup-instructions">
              <ol>
                <li>Click "Start Authentication" below</li>
                <li>Your browser will open to Google's authorization page</li>
                <li>Sign in with your Google account</li>
                <li>Grant permission to access your Gmail</li>
                <li>You'll be redirected back to the app automatically</li>
                <li>Your tokens will be saved and the MCP server will be configured</li>
              </ol>
            </div>
            <div className="setup-actions">
              <button onClick={setupGmailServer} className="button-primary">
                Start Authentication
              </button>
              <button
                onClick={() => setShowGmailSetup(false)}
                className="button-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>MCP Servers Configuration</h3>

        <div className="action-buttons">
          <button
            className={`action-button ${activeSection === "import" ? "active" : ""}`}
            onClick={() =>
              setActiveSection(activeSection === "import" ? "none" : "import")
            }
          >
            Import JSON
          </button>
          <button
            className={`action-button ${activeSection === "add" ? "active" : ""}`}
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
    </div>
  );
}
