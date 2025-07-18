import { useOllamaServer } from "../contexts/ollama-server-context";
import { usePostChatMessage } from "../hooks/use-post-chat-message";

import { ChatInput } from "./chat-input";
import { Badge } from "../../../components/ui/badge";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { AIResponse } from "../../../components/kibo/ai-response";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { AIReasoning, AIReasoningTrigger, AIReasoningContent } from "../../../components/kibo/ai-reasoning";

import { cn } from "../../../lib/utils";

interface MCPTool {
  serverName: string;
  tool: {
    name: string;
    description?: string;
    input_schema: any;
  };
}

interface ChatContainerProps {
  mcpTools: MCPTool[];
}

export function ChatContainer({ mcpTools }: ChatContainerProps) {
  const { ollamaPort } = useOllamaServer();

  const { chatHistory, isChatLoading, sendChatMessage, clearChatHistory } = usePostChatMessage({
    ollamaPort,
    mcpTools,
  });

  return (
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

        <ChatInput
          ollamaPort={ollamaPort}
          onSubmit={sendChatMessage}
          clearChatHistory={clearChatHistory}
          disabled={isChatLoading || !ollamaPort}
        />
      </CardContent>
    </Card>
  );
}
