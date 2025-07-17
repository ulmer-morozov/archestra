import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import MCPCatalogs from "./modules/mcp-catalog/components/mcp-catalogs";
import ChatContainer from "./modules/chat/components/chat-container";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import { CheckCircle, XCircle, MessageCircle, Bot, Bug } from "lucide-react";
import "./index.css";

function App() {
  const [ollamaPort, setOllamaPort] = useState<number | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [isOllamaRunning, setIsOllamaRunning] = useState(false);
  const [mcpServers, setMcpServers] = useState<{
    [key: string]: { command: string; args: string[] };
  }>({});
  const [mcpServerStatus, setMcpServerStatus] = useState<{
    [key: string]: string;
  }>({});
  const [mcpServerLoading, setMcpServerLoading] = useState<{
    [key: string]: boolean;
  }>({});
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
            }
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

      // Wait a moment for the server to start, then start MCP servers
      setTimeout(() => {
        autoStartMcpServers();
      }, 2000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
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
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      setOllamaStatus(`Error stopping Ollama: ${errorMsg}`);
      console.error("Error stopping Ollama:", error);
      setIsOllamaRunning(false);
      setOllamaPort(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            archestra.ai
          </h1>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value: string) => setActiveTab(value as "chat" | "mcp")}
          className="mb-6"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Chat with AI
            </TabsTrigger>
            <TabsTrigger value="mcp" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              MCP Catalogs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Ollama Local AI
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  {!isOllamaRunning ? (
                    <Button onClick={runOllamaServe} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Start Ollama Server
                    </Button>
                  ) : (
                    <Button onClick={stopOllamaServe} variant="destructive" className="flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Stop Ollama Server
                    </Button>
                  )}
                  <Button onClick={debugMcpBridge} variant="outline" className="flex items-center gap-2">
                    <Bug className="h-4 w-4" />
                    Debug MCP Bridge
                  </Button>
                </div>

                {ollamaStatus && (
                  <div
                    className={`p-3 rounded-md text-sm ${
                      ollamaStatus.includes("Error")
                        ? "bg-destructive/10 text-destructive border border-destructive/20"
                        : ollamaStatus.includes("successfully")
                        ? "bg-green-500/10 text-green-600 border border-green-500/20"
                        : "bg-muted text-muted-foreground border"
                    }`}
                  >
                    {ollamaStatus}
                  </div>
                )}

                {ollamaPort && (
                  <div className="p-3 rounded-md bg-green-500/10 text-green-600 border border-green-500/20 text-sm">
                    Ollama running on port: {ollamaPort}
                  </div>
                )}
              </CardContent>
            </Card>

            <ChatContainer ollamaPort={ollamaPort} mcpTools={mcpTools} />

            {debugInfo && (
              <Card ref={debugRef}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bug className="h-5 w-5" />
                    MCP Bridge Debug Info
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-96 w-full">
                    <pre className="text-sm font-mono whitespace-pre-wrap bg-slate-950 text-slate-50 p-4 rounded-md">
                      {debugInfo}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="mcp">
            <MCPCatalogs
              mcpServers={mcpServers}
              setMcpServers={setMcpServers}
              mcpServerStatus={mcpServerStatus}
              setMcpServerStatus={setMcpServerStatus}
              mcpServerLoading={mcpServerLoading}
              setMcpServerLoading={setMcpServerLoading}
              mcpServerStatuses={mcpServerStatuses}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default App;
