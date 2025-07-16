import { useState, useRef, useEffect } from "react";

import { ChatInput } from "./components/chat-input";
import { AIResponse } from "./components/kibo/ai-response";
import { AIReasoning, AIReasoningTrigger, AIReasoningContent } from "./components/kibo/ai-reasoning";

import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinkingContent?: string;
  timestamp: Date;
  isStreaming?: boolean;
  isThinkingStreaming?: boolean;
}

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (userMessage: string, model: string) => {
    if (!userMessage.trim()) return;

    const userMsgId = Date.now().toString();
    const newUserMessage: Message = {
      id: userMsgId,
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newUserMessage]);
    setIsLoading(true);

    const aiMsgId = (Date.now() + 1).toString();
    const aiMessage: Message = {
      id: aiMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    };

    setMessages((prev) => [...prev, aiMessage]);
    setIsLoading(false);

    try {
      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: userMessage,
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

              setMessages((prev) =>
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
              setMessages((prev) =>
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
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsgId
            ? {
                ...msg,
                content:
                  "Sorry, I couldn't connect to the local LLM. Please make sure ollama is running on port 11434.",
                isStreaming: false,
              }
            : msg
        )
      );
    }
  };

  const resetMessages = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <p>Start a conversation with your local llama3 model</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={cn(
                  "max-w-[80%] rounded-lg p-4",
                  message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {message.role === "user" ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                ) : (
                  <div className="relative">
                    {message.thinkingContent && (
                      <AIReasoning isStreaming={message.isThinkingStreaming} className="mb-4">
                        <AIReasoningTrigger />
                        <AIReasoningContent>{message.thinkingContent}</AIReasoningContent>
                      </AIReasoning>
                    )}
                    <AIResponse>{message.content}</AIResponse>
                    {message.isStreaming && (
                      <div className="flex justify-start">
                        <div className="max-w-[80%] rounded-lg py-1 bg-muted">
                          <div className="flex items-center space-x-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                            <p className="text-muted-foreground">Loading...</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 min-h-min max-h-min">
        <ChatInput onSubmit={sendMessage} onModelChange={resetMessages} disabled={isLoading} />
      </div>
    </div>
  );
}

export default ChatPage;
