import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Textarea } from "../../../components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../components/ui/collapsible";
import {
  Mail,
  Plus,
  Download,
  Play,
  Trash2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Server,
  Settings,
  ExternalLink,
  Copy,
  CheckCircle,
  XCircle,
} from "lucide-react";

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
  mcpServerStatuses: { [key: string]: boolean };
}

export function MCPCatalog({
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
  const [activeSection, setActiveSection] = useState<"none" | "import" | "add">("none");
  const [showGmailSetup, setShowGmailSetup] = useState(false);
  const [gcpProject, setGcpProject] = useState("");
  const [oauthCredentials, setOauthCredentials] = useState("");
  const [setupStep, setSetupStep] = useState(1);

  const serverListRef = useRef<HTMLDivElement>(null);

  async function addMcpServer() {
    if (!currentServerName.trim()) {
      alert("Please enter a server name");
      return;
    }

    const args = currentServerArgs.trim() ? currentServerArgs.split(" ").filter((arg) => arg.trim()) : [];

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
      const errorMsg = error instanceof Error ? error.message : "An unknown error occurred";
      setMcpServerStatus((prev) => ({
        ...prev,
        [serverName]: `Error: ${errorMsg}`,
      }));
    }

    setMcpServerLoading((prev) => ({ ...prev, [serverName]: false }));
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
      const errorMsg = error instanceof Error ? error.message : "An unknown error occurred";
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
        if (typeof config === "object" && "command" in config && "args" in config && Array.isArray(config.args)) {
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
          alert(`Successfully imported ${Object.keys(validServers).length} server(s)!`);

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
      alert(`Error importing JSON: ${error instanceof Error ? error.message : "Invalid JSON"}`);
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Featured MCP Servers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <Card className="border-2 border-dashed border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Mail className="h-5 w-5 text-primary" />
                      <h4 className="font-semibold">Gmail MCP Server</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Access and manage your Gmail messages with AI</p>
                    <div className="flex gap-2">
                      <Badge variant="secondary">Email Management</Badge>
                      <Badge variant="outline">OAuth Required</Badge>
                    </div>
                  </div>
                  <Button onClick={() => setShowGmailSetup(true)} className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Setup Gmail
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {showGmailSetup && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Gmail MCP Server Setup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Setup Progress</span>
                <span>Step {setupStep} of 4</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(setupStep / 4) * 100}%` }}
                />
              </div>
            </div>

            <div className="space-y-4">
              {setupStep === 1 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                      1
                    </div>
                    <h4 className="font-semibold">Create Google Cloud Project</h4>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Create a new project in the{" "}
                    <Button variant="link" className="p-0 h-auto" asChild>
                      <a
                        href="https://console.cloud.google.com/"
                        target="_blank"
                        className="inline-flex items-center gap-1"
                      >
                        Google Cloud Console
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="gcp-project">Project ID (optional - for reference)</Label>
                    <Input
                      id="gcp-project"
                      value={gcpProject}
                      onChange={(e) => setGcpProject(e.target.value)}
                      placeholder="my-gmail-mcp-project"
                    />
                  </div>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-6">
                      <h5 className="font-medium mb-2">Instructions:</h5>
                      <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                        <li>Go to Google Cloud Console</li>
                        <li>Click "New Project"</li>
                        <li>Enter a project name</li>
                        <li>Click "Create"</li>
                      </ol>
                    </CardContent>
                  </Card>
                </div>
              )}

              {setupStep === 2 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                      2
                    </div>
                    <h4 className="font-semibold">Enable Gmail API</h4>
                  </div>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-6">
                      <h5 className="font-medium mb-2">Instructions:</h5>
                      <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                        <li>Go to the APIs & Services dashboard</li>
                        <li>Click "Enable APIs and Services"</li>
                        <li>Search for "Gmail API"</li>
                        <li>Click on Gmail API and then "Enable"</li>
                      </ol>
                    </CardContent>
                  </Card>
                  <Button variant="outline" asChild>
                    <a
                      href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                      target="_blank"
                      className="inline-flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Direct link to Gmail API
                    </a>
                  </Button>
                </div>
              )}

              {setupStep === 3 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                      3
                    </div>
                    <h4 className="font-semibold">Create OAuth 2.0 Credentials</h4>
                  </div>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-6">
                      <h5 className="font-medium mb-2">Instructions:</h5>
                      <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                        <li>Go to APIs & Services → Credentials</li>
                        <li>Click "Create Credentials" → "OAuth 2.0 Client IDs"</li>
                        <li>Choose "Desktop application" as the application type</li>
                        <li>Give it a name (e.g., "Gmail MCP Client")</li>
                        <li>Click "Create"</li>
                        <li>Download the JSON file</li>
                      </ol>
                    </CardContent>
                  </Card>
                  <Button variant="outline" asChild>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      className="inline-flex items-center gap-2"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Go to Credentials page
                    </a>
                  </Button>
                </div>
              )}

              {setupStep === 4 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
                      4
                    </div>
                    <h4 className="font-semibold">Save OAuth Credentials</h4>
                  </div>
                  <Card className="bg-muted/50">
                    <CardContent className="pt-6">
                      <h5 className="font-medium mb-2">Instructions:</h5>
                      <ol className="text-sm space-y-1 text-muted-foreground list-decimal list-inside">
                        <li>Rename the downloaded file to "gcp-oauth.keys.json"</li>
                        <li>Create directory: ~/.gmail-mcp</li>
                        <li>Move the file to: ~/.gmail-mcp/gcp-oauth.keys.json</li>
                        <li>Run authentication: npx @gongrzhe/server-gmail-autoauth-mcp auth</li>
                      </ol>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-950 text-slate-50">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Terminal Commands</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-slate-50 hover:bg-slate-800"
                          onClick={() =>
                            navigator.clipboard?.writeText(
                              "mkdir -p ~/.gmail-mcp\nmv ~/Downloads/gcp-oauth.keys.json ~/.gmail-mcp/\nnpx @gongrzhe/server-gmail-autoauth-mcp auth"
                            )
                          }
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="font-mono text-sm space-y-1">
                        <div>mkdir -p ~/.gmail-mcp</div>
                        <div>mv ~/Downloads/gcp-oauth.keys.json ~/.gmail-mcp/</div>
                        <div>npx @gongrzhe/server-gmail-autoauth-mcp auth</div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <div>
                {setupStep > 1 && (
                  <Button variant="outline" onClick={handlePrevStep} className="flex items-center gap-2">
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowGmailSetup(false)}>
                  Cancel
                </Button>
                <Button onClick={handleNextStep} className="flex items-center gap-2">
                  {setupStep === 4 ? (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      Complete Setup
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            MCP Servers Configuration
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex gap-2">
            <Collapsible
              className="w-full"
              open={activeSection === "import"}
              onOpenChange={(open) => setActiveSection(open ? "import" : "none")}
            >
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2 w-full">
                  <Download className="h-4 w-4" />
                  Import JSON
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4 w-full">
                <Card className="bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-base">Import from JSON</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="json-import">MCP Configuration JSON</Label>
                      <Textarea
                        id="json-import"
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
                        className="min-h-32 font-mono text-sm"
                      />
                    </div>
                    <Button onClick={importFromJson} disabled={!jsonImport.trim()} className="flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      Import Servers
                    </Button>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible
              open={activeSection === "add"}
              onOpenChange={(open) => setActiveSection(open ? "add" : "none")}
              className="w-full"
            >
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2 w-full">
                  <Plus className="h-4 w-4" />
                  Add New MCP
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-4">
                <Card className="bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-base">Add New MCP Server</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="server-name">Server Name</Label>
                      <Input
                        id="server-name"
                        value={currentServerName}
                        onChange={(e) => setCurrentServerName(e.target.value)}
                        placeholder="e.g., github, context7, browser-tools"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                      <div className="md:col-span-3 space-y-2">
                        <Label htmlFor="server-args">Arguments</Label>
                        <Input
                          id="server-args"
                          value={currentServerArgs}
                          onChange={(e) => setCurrentServerArgs(e.target.value)}
                          placeholder="e.g., GITHUB_PERSONAL_ACCESS_TOKEN=token npx -y @modelcontextprotocol/server-github"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="server-command">Command</Label>
                        <Select value={currentServerCommand} onValueChange={setCurrentServerCommand}>
                          <SelectTrigger id="server-command">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="env">env</SelectItem>
                            <SelectItem value="npx">npx</SelectItem>
                            <SelectItem value="node">node</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      onClick={addMcpServer}
                      disabled={!currentServerName.trim()}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Add Server Configuration
                    </Button>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-semibold flex items-center gap-2">
              <Server className="h-4 w-4" />
              Configured MCP Servers
            </h4>

            {Object.entries(mcpServers).length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="pt-6">
                  <div className="text-center py-8 text-muted-foreground">
                    <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No servers configured yet.</p>
                    <p className="text-sm">Add your first MCP server to get started.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-96">
                <div className="space-y-3" ref={serverListRef}>
                  {Object.entries(mcpServers).map(([name, config]) => (
                    <Card key={name} className="hover:shadow-md transition-shadow">
                      <CardContent className="pt-6">
                        <div className="flex items-start justify-between">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">{name}</h4>
                              <Badge variant="outline" className="text-xs">
                                {config.command}
                              </Badge>
                              <Badge variant={mcpServerStatuses[name] ? "default" : "secondary"} className="text-xs">
                                {mcpServerStatuses[name] ? "🟢 Running" : "⚫ Stopped"}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <div>
                                <span className="font-medium">Command:</span> {config.command}
                              </div>
                              <div>
                                <span className="font-medium">Args:</span> {config.args.join(" ") || "None"}
                              </div>
                            </div>
                            {mcpServerStatus[name] && (
                              <div
                                className={`text-sm p-2 rounded border ${
                                  mcpServerStatus[name].includes("Error")
                                    ? "bg-destructive/10 text-destructive border-destructive/20"
                                    : mcpServerStatus[name].includes("result") ||
                                      mcpServerStatus[name].includes("Auto-started")
                                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                                    : "bg-muted text-muted-foreground border-muted"
                                }`}
                              >
                                {mcpServerStatus[name]}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            {mcpServerStatuses[name] ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => stopMcpServer(name)}
                                disabled={mcpServerLoading[name]}
                                className="flex items-center gap-2"
                              >
                                {mcpServerLoading[name] ? (
                                  <>
                                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                    Stopping...
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-3 w-3" />
                                    Stop
                                  </>
                                )}
                              </Button>
                            ) : (
                              <div className="text-sm text-muted-foreground">Auto-starts with Ollama</div>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => removeMcpServer(name)}
                              disabled={mcpServerLoading[name]}
                              className="flex items-center gap-2"
                            >
                              <Trash2 className="h-3 w-3" />
                              Remove
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
