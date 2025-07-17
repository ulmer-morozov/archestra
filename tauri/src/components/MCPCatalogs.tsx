import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MCPServer {
  command: string;
  args: string[];
}

interface MCPCatalogsProps {
  mcpServers: { [key: string]: MCPServer };
  setMcpServers: React.Dispatch<
    React.SetStateAction<{ [key: string]: MCPServer }>
  >;
  mcpServerStatus: { [key: string]: string };
  setMcpServerStatus: React.Dispatch<
    React.SetStateAction<{ [key: string]: string }>
  >;
  mcpServerLoading: { [key: string]: boolean };
  setMcpServerLoading: React.Dispatch<
    React.SetStateAction<{ [key: string]: boolean }>
  >;
  mcpServerStatuses: { [key: string]: boolean };
}

export default function MCPCatalogs({
  mcpServers,
  setMcpServers,
  mcpServerStatus,
  setMcpServerStatus,
  mcpServerLoading,
  setMcpServerLoading,
  mcpServerStatuses,
}: MCPCatalogsProps) {
  const [currentServerName, setCurrentServerName] = useState("");
  const [currentServerCommand, setCurrentServerCommand] = useState("env");
  const [currentServerArgs, setCurrentServerArgs] = useState("");
  const [jsonImport, setJsonImport] = useState("");
  const [activeSection, setActiveSection] = useState<"none" | "import" | "add">(
    "none",
  );
  const [showGmailSetup, setShowGmailSetup] = useState(false);
  const [gcpProject, setGcpProject] = useState("");
  const [setupStep, setSetupStep] = useState(1);

  const serverListRef = useRef<HTMLDivElement>(null);

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

  async function stopMcpServer(serverName: string) {
    setMcpServerLoading((prev) => ({ ...prev, [serverName]: true }));
    setMcpServerStatus((prev) => ({
      ...prev,
      [serverName]: "Stopping MCP server...",
    }));

    try {
      await invoke("stop_persistent_mcp_server", {
        name: serverName,
      });

      setMcpServerStatus((prev) => ({
        ...prev,
        [serverName]: "MCP server stopped",
      }));
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "An unknown error occurred";
      setMcpServerStatus((prev) => ({
        ...prev,
        [serverName]: `Error stopping server: ${errorMsg}`,
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
              }),
            ),
          );

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
        }`,
      );
    }
  }

  async function setupGmailServer() {
    try {
      await invoke("save_mcp_server", {
        name: "Gmail MCP Server",
        command: "npx",
        args: ["@gongrzhe/server-gmail-autoauth-mcp"],
      });

      setMcpServers((prev) => ({
        ...prev,
        "Gmail MCP Server": {
          command: "npx",
          args: ["@gongrzhe/server-gmail-autoauth-mcp"],
        },
      }));

      setShowGmailSetup(false);
      setSetupStep(1);
      alert("Gmail MCP Server has been configured successfully!");
    } catch (error) {
      console.error("Failed to setup Gmail MCP server:", error);
      alert("Failed to setup Gmail MCP server. Please try again.");
    }
  }

  const handleNextStep = () => {
    if (setupStep < 4) {
      setSetupStep(setupStep + 1);
    } else {
      setupGmailServer();
    }
  };

  const handlePrevStep = () => {
    if (setupStep > 1) {
      setSetupStep(setupStep - 1);
    }
  };

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
                  <span className="tag">OAuth Required</span>
                </div>
              </div>
              <div className="server-actions">
                <button
                  onClick={() => setShowGmailSetup(true)}
                  className="featured-button"
                >
                  Setup Gmail
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showGmailSetup && (
        <div className="card">
          <h3>Gmail MCP Server Setup</h3>
          <div className="setup-wizard">
            <div className="setup-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(setupStep / 4) * 100}%` }}
                ></div>
              </div>
              <span>Step {setupStep} of 4</span>
            </div>

            {setupStep === 1 && (
              <div className="setup-step">
                <h4>1. Create Google Cloud Project</h4>
                <p>
                  Create a new project in the{" "}
                  <a href="https://console.cloud.google.com/" target="_blank">
                    Google Cloud Console
                  </a>
                </p>
                <div className="form-group">
                  <label>Project ID (optional - for reference)</label>
                  <input
                    value={gcpProject}
                    onChange={(e) => setGcpProject(e.target.value)}
                    placeholder="my-gmail-mcp-project"
                  />
                </div>
                <div className="setup-instructions">
                  <ol>
                    <li>Go to Google Cloud Console</li>
                    <li>Click "New Project"</li>
                    <li>Enter a project name</li>
                    <li>Click "Create"</li>
                  </ol>
                </div>
              </div>
            )}

            {setupStep === 2 && (
              <div className="setup-step">
                <h4>2. Enable Gmail API</h4>
                <div className="setup-instructions">
                  <ol>
                    <li>Go to the APIs & Services dashboard</li>
                    <li>Click "Enable APIs and Services"</li>
                    <li>Search for "Gmail API"</li>
                    <li>Click on Gmail API and then "Enable"</li>
                  </ol>
                </div>
                <p>
                  <a
                    href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                    target="_blank"
                  >
                    Direct link to Gmail API
                  </a>
                </p>
              </div>
            )}

            {setupStep === 3 && (
              <div className="setup-step">
                <h4>3. Create OAuth 2.0 Credentials</h4>
                <div className="setup-instructions">
                  <ol>
                    <li>Go to APIs & Services {">"} Credentials</li>
                    <li>
                      Click "Create Credentials" {">"} "OAuth 2.0 Client IDs"
                    </li>
                    <li>
                      Choose "Desktop application" as the application type
                    </li>
                    <li>Give it a name (e.g., "Gmail MCP Client")</li>
                    <li>Click "Create"</li>
                    <li>Download the JSON file</li>
                  </ol>
                </div>
                <p>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                  >
                    Go to Credentials page
                  </a>
                </p>
              </div>
            )}

            {setupStep === 4 && (
              <div className="setup-step">
                <h4>4. Save OAuth Credentials</h4>
                <div className="setup-instructions">
                  <ol>
                    <li>Rename the downloaded file to "gcp-oauth.keys.json"</li>
                    <li>Create directory: ~/.gmail-mcp</li>
                    <li>Move the file to: ~/.gmail-mcp/gcp-oauth.keys.json</li>
                    <li>
                      Run authentication: npx
                      @gongrzhe/server-gmail-autoauth-mcp auth
                    </li>
                  </ol>
                </div>
                <div className="code-block">
                  <code>
                    mkdir -p ~/.gmail-mcp
                    <br />
                    mv ~/Downloads/gcp-oauth.keys.json ~/.gmail-mcp/
                    <br />
                    npx @gongrzhe/server-gmail-autoauth-mcp auth
                  </code>
                </div>
              </div>
            )}

            <div className="setup-actions">
              {setupStep > 1 && (
                <button onClick={handlePrevStep} className="button-secondary">
                  Previous
                </button>
              )}
              <button onClick={handleNextStep} className="button-primary">
                {setupStep === 4 ? "Complete Setup" : "Next"}
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
                      {mcpServerStatuses[name] ? (
                        <button
                          onClick={() => stopMcpServer(name)}
                          disabled={mcpServerLoading[name]}
                          className="button-danger"
                        >
                          {mcpServerLoading[name] ? "Stopping..." : "Stop"}
                        </button>
                      ) : (
                        <span style={{ color: "#718096", fontSize: "0.9em" }}>
                          Auto-starts with Ollama
                        </span>
                      )}
                      <button
                        onClick={() => removeMcpServer(name)}
                        disabled={mcpServerLoading[name]}
                        className="button-danger"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="server-status">
                    <div
                      className={`status-indicator ${
                        mcpServerStatuses[name]
                          ? "status-running"
                          : "status-stopped"
                      }`}
                    >
                      {mcpServerStatuses[name] ? "🟢 Running" : "⚫ Stopped"}
                    </div>
                    {mcpServerStatus[name] && (
                      <div
                        className={`status-text ${
                          mcpServerStatus[name].includes("Error")
                            ? "status-error"
                            : mcpServerStatus[name].includes("success") ||
                              mcpServerStatus[name].includes("Auto-started")
                            ? "status-success"
                            : ""
                        }`}
                      >
                        {mcpServerStatus[name]}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
