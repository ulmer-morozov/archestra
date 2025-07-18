import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useState, useCallback, useEffect } from "react";

interface IChatMessage {
  id: string;
  role: string;
  content: string;
  thinkingContent?: string;
  timestamp: Date;
  isStreaming?: boolean;
  isThinkingStreaming?: boolean;
  toolCalls?: ToolCallInfo[];
  isToolExecuting?: boolean;
}

interface ToolCallInfo {
  id: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, any>;
  result?: string;
  error?: string;
  status: "pending" | "executing" | "completed" | "error";
  executionTime?: number;
  startTime: Date;
  endTime?: Date;
}

interface MCPTool {
  serverName: string;
  tool: {
    name: string;
    description?: string;
    input_schema: any;
  };
}

interface IArgs {
  ollamaPort: number | null;
  mcpTools: MCPTool[];
}

export function usePostChatMessage({ ollamaPort, mcpTools }: IArgs) {
  const [chatHistory, setChatHistory] = useState<IChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null,
  );

  const clearChatHistory = useCallback(() => {
    setChatHistory([]);
  }, []);

  // Set up streaming event listeners
  useEffect(() => {
    const setupListeners = async () => {
      // Listen for streaming chunks
      const unlistenChunk = await listen("ollama-chunk", (event: any) => {
        const { total_content } = event.payload;

        // Update the streaming message in chat history
        setChatHistory((prev) => {
          return prev.map((msg) =>
            msg.id === streamingMessageId && msg.isStreaming
              ? {
                  ...msg,
                  content: total_content,
                }
              : msg,
          );
        });
      });

      // Listen for tool results
      const unlistenToolResults = await listen(
        "ollama-tool-results",
        (event: any) => {
          const { tool_results, message } = event.payload;

          if (tool_results && tool_results.length > 0 && streamingMessageId) {
            // Extract tool calls from the message to get server/tool names
            const originalToolCalls = message?.tool_calls || [];

            // Create tool call info from results
            const toolCallsInfo: ToolCallInfo[] = tool_results.map(
              (toolResult: any, index: number) => {
                const toolId = `tool-${Date.now()}-${index}`;

                // Try to match tool result with original tool call to get metadata
                const matchingToolCall = originalToolCalls[index];
                let serverName = "mcp";
                let toolName = `tool-${index + 1}`;
                let toolArguments = {};

                if (matchingToolCall?.function) {
                  const functionName = matchingToolCall.function.name;
                  if (functionName && functionName.includes("_")) {
                    const [server, tool] = functionName.split("_", 2);
                    serverName = server;
                    toolName = tool;
                  }
                  toolArguments = matchingToolCall.function.arguments || {};
                }

                // Extract text content from the complex structure
                let resultContent = "";
                if (toolResult.content) {
                  if (typeof toolResult.content === "string") {
                    resultContent = toolResult.content;
                  } else if (Array.isArray(toolResult.content)) {
                    // Handle array of content objects
                    resultContent = toolResult.content
                      .map((item: any) => item.text || item.content || item)
                      .join("\n");
                  } else if (toolResult.content.text) {
                    resultContent = toolResult.content.text;
                  } else {
                    resultContent = JSON.stringify(toolResult.content, null, 2);
                  }
                } else if (toolResult.result) {
                  resultContent = toolResult.result;
                }

                return {
                  id: toolId,
                  serverName,
                  toolName,
                  arguments: toolArguments,
                  result: resultContent,
                  error: toolResult.error,
                  status: toolResult.error ? "error" : ("completed" as const),
                  executionTime: 0,
                  startTime: new Date(),
                  endTime: new Date(),
                };
              },
            );

            // Update AI message with tool execution info
            setChatHistory((prev) =>
              prev.map((msg) =>
                msg.id === streamingMessageId
                  ? {
                      ...msg,
                      isToolExecuting: false,
                      toolCalls: toolCallsInfo,
                    }
                  : msg,
              ),
            );

            // Add individual tool result messages
            for (const toolResult of tool_results) {
              const toolMessage = {
                id: (Date.now() + Math.random()).toString(),
                role: "tool",
                content: `Tool: ${toolResult.tool_name}\nResult: ${toolResult.result}`,
                timestamp: new Date(),
              };
              setChatHistory((prev) => [...prev, toolMessage]);
            }
          }
        },
      );

      // Listen for completion
      const unlistenComplete = await listen("ollama-complete", (event: any) => {
        const { content } = event.payload;

        // Finalize the streaming message
        setChatHistory((prev) => {
          return prev.map((msg) =>
            msg.id === streamingMessageId && msg.isStreaming
              ? {
                  ...msg,
                  content: content,
                  isStreaming: false,
                  isToolExecuting: false,
                }
              : msg,
          );
        });

        setStreamingMessageId(null);
        setIsChatLoading(false);
      });

      return () => {
        unlistenChunk();
        unlistenToolResults();
        unlistenComplete();
      };
    };

    const cleanup = setupListeners();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, [streamingMessageId]);

  const sendChatMessage = useCallback(
    async (message: string, model: string) => {
      if (!message.trim() || !ollamaPort) return;

      setIsChatLoading(true);

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
            model.includes("hermes") ||
            model.includes("llama3") ||
            model.includes("llama-3") ||
            model.includes("phi") ||
            model.includes("granite"));

        console.log("🔧 Tool calling debug:", {
          mcpToolsCount: mcpTools.length,
          modelSupportsTools,
          model,
          willUseMcpTools: mcpTools.length > 0 && modelSupportsTools,
        });

        if (mcpTools.length > 0 && modelSupportsTools) {
          console.log(
            "🎯 Using streaming tool-enabled chat with",
            mcpTools.length,
            "tools",
          );

          // Set the streaming message ID
          setStreamingMessageId(aiMsgId);

          // Mark AI message as tool executing
          setChatHistory((prev) =>
            prev.map((msg) =>
              msg.id === aiMsgId
                ? {
                    ...msg,
                    isToolExecuting: true,
                    content:
                      "🔧 Analyzing your request and preparing to execute tools...",
                  }
                : msg,
            ),
          );

          // Use the streaming tool-enabled chat
          const messages = [
            { role: "user", content: currentMessage, tool_calls: null },
          ];

          await invoke("ollama_chat_with_tools_streaming", {
            port: ollamaPort,
            model: model,
            messages: messages,
          });

          // The response will be handled by the event listeners
        } else {
          console.log(
            "📡 Using streaming chat (tools disabled or model doesn't support tools)",
          );

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
          const response = await fetch(
            `http://localhost:${ollamaPort}/api/chat`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: model,
                messages: [
                  ...chatHistory.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                  })),
                  { role: "user", content: currentMessage },
                ],
                stream: true,
                options: {
                  temperature: 0.7,
                  top_p: 0.95,
                  top_k: 40,
                  num_predict: 32768,
                },
              }),
            },
          );

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

                if (data.message?.content) {
                  accumulatedContent += data.message.content;

                  const parseContent = (content: string) => {
                    const thinkStartMatch = content.match(/<think>/);
                    const thinkEndMatch = content.match(/<\/think>/);

                    if (thinkStartMatch && thinkEndMatch) {
                      const thinkStart = thinkStartMatch.index!;
                      const thinkEnd = thinkEndMatch.index!;

                      const beforeThink = content.substring(0, thinkStart);
                      const thinkingContent = content.substring(
                        thinkStart + 7,
                        thinkEnd,
                      );
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
                            isThinkingStreaming:
                              parsed.isThinkingStreaming && !data.done,
                          }
                        : msg,
                    ),
                  );
                }

                if (data.done) {
                  setChatHistory((prev) =>
                    prev.map((msg) =>
                      msg.id === aiMsgId
                        ? {
                            ...msg,
                            isStreaming: false,
                            isThinkingStreaming: false,
                          }
                        : msg,
                    ),
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
        const errorMsg =
          error instanceof Error ? error.message : "An unknown error occurred";
        setChatHistory((prev) =>
          prev.map((msg) =>
            msg.id === aiMsgId
              ? {
                  ...msg,
                  content: `Error: ${errorMsg}`,
                  isStreaming: false,
                }
              : msg,
          ),
        );
      }

      setIsChatLoading(false);
    },
    [ollamaPort, mcpTools],
  );

  return {
    chatHistory,
    isChatLoading,
    sendChatMessage,
    clearChatHistory,
  };
}
