import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import MCPCatalogs from "./modules/mcp-catalog/components/mcp-catalogs";
import { ChatInput } from "./modules/chat/components/chat-input";
import { AIResponse } from "./components/kibo/ai-response";
import { AIReasoning, AIReasoningTrigger, AIReasoningContent } from "./components/kibo/ai-reasoning";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import { CheckCircle, XCircle, MessageCircle, Bot, Bug } from "lucide-react";
import { cn } from "./lib/utils";
import "./index.css";

function App() {
  const [ollamaPort, setOllamaPort] = useState<number | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [isOllamaRunning, setIsOllamaRunning] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    {
      id: string;
      role: string;
      content: string;
      thinkingContent?: string;
      timestamp: Date;
      isStreaming?: boolean;
      isThinkingStreaming?: boolean;
    }[]
  >([]);
  const [chatLoading, setChatLoading] = useState(false);
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

  async function sendChatMessage(message: string, model: string) {
    if (!message.trim() || !ollamaPort) return;

    setChatLoading(true);

    const userMsgId = Date.now().toString();
    const userMessage = {
      id: userMsgId,
      role: "user",
      content: message,
      timestamp: new Date(),
    };
    setChatHistory((prev) => [...prev, userMessage]);

    const aiMsgId = (Date.now() + 1).toString();
    const aiMessage = {
      id: aiMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };
    setChatHistory((prev) => [...prev, aiMessage]);

    const currentMessage = message;

    try {
      // Check if the model supports tool calling
      const modelSupportsTools =
        model &&
        (model.includes("functionary") ||
          model.includes("mistral") ||
          model.includes("command") ||
          model.includes("qwen") ||
          model.includes("hermes"));

      if (mcpTools.length > 0 && modelSupportsTools) {
        // Use the enhanced tool-enabled chat
        const messages = [{ role: "user", content: currentMessage, tool_calls: null }];

        const response = await invoke<any>("ollama_chat_with_tools", {
          port: ollamaPort,
          model: model,
          messages: messages,
        });

        console.log("Tool-enabled response:", response);

        if (response.tool_results && response.tool_results.length > 0) {
          // Add tool execution results to chat history
          for (const toolResult of response.tool_results) {
            const toolMessage = {
              id: (Date.now() + Math.random()).toString(),
              role: "tool",
              content: `Tool executed: ${toolResult.content}`,
              timestamp: new Date(),
            };
            setChatHistory((prev) => [...prev, toolMessage]);
          }
        }

        if (response.message && response.message.content) {
          setChatHistory((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId
                ? {
                    ...msg,
                    content: response.message.content,
                    isStreaming: false,
                  }
                : msg
            )
          );
        }
      } else {
        // Add warning if tools are available but model doesn't support them
        if (mcpTools.length > 0 && !modelSupportsTools) {
          const warningMessage = {
            id: (Date.now() + Math.random()).toString(),
            role: "system",
            content: `⚠️ MCP tools are available but ${model} doesn't support tool calling. Consider using functionary-small-v3.2 or another tool-enabled model.`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, warningMessage]);
        }

        // Use streaming Ollama chat with thinking content parsing
        const response = await fetch(`http://localhost:${ollamaPort}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: model,
            prompt: currentMessage,
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let accumulatedContent = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.response) {
                accumulatedContent += data.response;

                const parseContent = (content: string) => {
                  const thinkStartMatch = content.match(/<think>/);
                  const thinkEndMatch = content.match(/<\/think>/);

                  if (thinkStartMatch && thinkEndMatch) {
                    const thinkStart = thinkStartMatch.index!;
                    const thinkEnd = thinkEndMatch.index!;

                    const beforeThink = content.substring(0, thinkStart);
                    const thinkingContent = content.substring(thinkStart + 7, thinkEnd);
                    const afterThink = content.substring(thinkEnd + 8);

                    return {
                      thinking: thinkingContent,
                      response: beforeThink + afterThink,
                      isThinkingStreaming: false,
                    };
                  } else if (thinkStartMatch && !thinkEndMatch) {
                    const thinkStart = thinkStartMatch.index!;
                    const beforeThink = content.substring(0, thinkStart);
                    const thinkingContent = content.substring(thinkStart + 7);

                    return {
                      thinking: thinkingContent,
                      response: beforeThink,
                      isThinkingStreaming: true,
                    };
                  } else {
                    return {
                      thinking: "",
                      response: content,
                      isThinkingStreaming: false,
                    };
                  }
                };

                const parsed = parseContent(accumulatedContent);

                setChatHistory((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMsgId
                      ? {
                          ...msg,
                          content: parsed.response,
                          thinkingContent: parsed.thinking,
                          isStreaming: !data.done,
                          isThinkingStreaming: parsed.isThinkingStreaming && !data.done,
                        }
                      : msg
                  )
                );
              }

              if (data.done) {
                setChatHistory((prev) =>
                  prev.map((msg) =>
                    msg.id === aiMsgId ? { ...msg, isStreaming: false, isThinkingStreaming: false } : msg
                  )
                );
                break;
              }
            } catch (parseError) {
              console.warn("Failed to parse chunk:", line);
            }
          }
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "An unknown error occurred";
      setChatHistory((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                content: `Error: ${errorMsg}`,
                isStreaming: false,
              }
            : msg
        )
      );
    }

    setChatLoading(false);
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

            <Card>
              <CardHeader>
                <CardTitle>Chat with Ollama</CardTitle>
                {mcpTools.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {mcpTools.length} MCP tool{mcpTools.length !== 1 ? "s" : ""} available
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <ScrollArea className="h-96 w-full rounded-md border p-4">
                  <div className="space-y-4">
                    {chatHistory.map((msg, index) => (
                      <div
                        key={msg.id || index}
                        className={cn(
                          "p-3 rounded-lg",
                          msg.role === "user"
                            ? "bg-primary/10 border border-primary/20 ml-8"
                            : msg.role === "assistant"
                            ? "bg-secondary/50 border border-secondary mr-8"
                            : msg.role === "error"
                            ? "bg-destructive/10 border border-destructive/20 text-destructive"
                            : msg.role === "system"
                            ? "bg-yellow-500/10 border border-yellow-500/20 text-yellow-600"
                            : msg.role === "tool"
                            ? "bg-blue-500/10 border border-blue-500/20 text-blue-600"
                            : "bg-muted border"
                        )}
                      >
                        <div className="text-xs font-medium mb-1 opacity-70 capitalize">{msg.role}</div>
                        {msg.role === "user" ? (
                          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                        ) : msg.role === "assistant" ? (
                          <div className="relative">
                            {msg.thinkingContent && (
                              <AIReasoning isStreaming={msg.isThinkingStreaming} className="mb-4">
                                <AIReasoningTrigger />
                                <AIReasoningContent>{msg.thinkingContent}</AIReasoningContent>
                              </AIReasoning>
                            )}
                            <AIResponse>{msg.content}</AIResponse>
                            {msg.isStreaming && (
                              <div className="flex items-center space-x-2 mt-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                                <p className="text-muted-foreground text-sm">Loading...</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {ollamaPort && (
                  <ChatInput onSubmit={sendChatMessage} disabled={chatLoading || !ollamaPort} ollamaPort={ollamaPort} />
                )}
              </CardContent>
            </Card>

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
