"use client";

import { useState } from "react";
import {
  AIInput,
  AIInputTextarea,
  AIInputToolbar,
  AIInputTools,
  AIInputButton,
  AIInputSubmit,
  AIInputModelSelect,
  AIInputModelSelectTrigger,
  AIInputModelSelectContent,
  AIInputModelSelectItem,
  AIInputModelSelectValue,
} from "@/components/kibo/ai-input";
import { PaperclipIcon, MicIcon } from "lucide-react";

interface SimpleChatInputProps {
  onSubmit: (message: string) => Promise<void>;
  disabled?: boolean;
}

export function ChatInput({ onSubmit, disabled = false }: SimpleChatInputProps) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"submitted" | "streaming" | "ready" | "error">("ready");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!message.trim() || disabled) {
      return;
    }

    setStatus("submitted");

    try {
      await onSubmit(message.trim());
      setMessage("");
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setTimeout(() => setStatus("ready"), 2000);
    }
  };

  return (
    <div className="m-3">
      <AIInput onSubmit={handleSubmit}>
        <AIInputTextarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What would you like to know?"
          disabled={disabled}
          minHeight={48}
          maxHeight={164}
        />
        <AIInputToolbar>
          <AIInputTools>
            <AIInputModelSelect defaultValue="gpt-4">
              <AIInputModelSelectTrigger>
                <AIInputModelSelectValue />
              </AIInputModelSelectTrigger>
              <AIInputModelSelectContent>
                <AIInputModelSelectItem value="gpt-4">GPT-4</AIInputModelSelectItem>
                <AIInputModelSelectItem value="gpt-3.5">GPT-3.5</AIInputModelSelectItem>
                <AIInputModelSelectItem value="claude">Claude</AIInputModelSelectItem>
              </AIInputModelSelectContent>
            </AIInputModelSelect>
            <AIInputButton>
              <PaperclipIcon size={16} />
            </AIInputButton>
            <AIInputButton>
              <MicIcon size={16} />
            </AIInputButton>
          </AIInputTools>
          <AIInputSubmit status={status} disabled={disabled || !message.trim()} />
        </AIInputToolbar>
      </AIInput>
    </div>
  );
}
