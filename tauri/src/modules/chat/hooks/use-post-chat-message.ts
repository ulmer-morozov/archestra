import { invoke } from "@tauri-apps/api/core";
import { useState, useCallback } from "react";

interface IChatMessage {
  id: string;
  role: string;
  content: string;
  thinkingContent?: string;
  timestamp: Date;
  isStreaming?: boolean;
  isThinkingStreaming?: boolean;
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

  const clearChatHistory = useCallback(() => {
    setChatHistory([]);
  }, []);

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

      setIsChatLoading(false);
    },
    [ollamaPort, mcpTools]
  );

  return {
    chatHistory,
    isChatLoading,
    sendChatMessage,
    clearChatHistory,
  };
}
