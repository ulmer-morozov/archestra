"use client";

import { useState, useEffect } from "react";
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
} from "../../../components/kibo/ai-input";
import { PaperclipIcon, MicIcon } from "lucide-react";
import { useFetchOllamaModels } from "../hooks/use-fetch-ollama-models";

interface SimpleChatInputProps {
  onSubmit: (message: string, model: string) => Promise<void>;
  onModelChange?: (modelName: string) => void;
  disabled?: boolean;
  ollamaPort: number | null;
  availableModels?: string[];
  selectedModel?: string | null;
  modelsLoading?: boolean;
}

export function ChatInput({
  onSubmit,
  onModelChange,
  disabled = false,
  ollamaPort,
  selectedModel,
}: SimpleChatInputProps) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"submitted" | "streaming" | "ready" | "error">("ready");
  const [selectedModelState, setSelectedModel] = useState<string>(selectedModel || "");

  const { data: availableModels = [], isLoading: modelsLoading, isError } = useFetchOllamaModels({ ollamaPort });

  useEffect(() => {
    if (availableModels.length > 0 && !selectedModel) {
      setSelectedModel(availableModels[0]);
    }
  }, [availableModels, selectedModel]);

  useEffect(() => {
    if (selectedModel && selectedModel !== selectedModelState) {
      setSelectedModel(selectedModel);
    }
  }, [selectedModel, selectedModelState]);

  const handleSubmit = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) {
      e.preventDefault();
    }

    if (!message.trim() || disabled || !selectedModelState) {
      return;
    }

    setStatus("submitted");

    try {
      await onSubmit(message.trim(), selectedModelState);
      setMessage("");
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setTimeout(() => setStatus("ready"), 2000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newMessage = message.substring(0, start) + "\n" + message.substring(end);
        setMessage(newMessage);

        setTimeout(() => {
          textarea.setSelectionRange(start + 1, start + 1);
        }, 0);
      } else {
        e.preventDefault();
        handleSubmit();
      }
    }
  };

  const handleModelChange = (modelName: string) => {
    setSelectedModel(modelName);
    onModelChange?.(modelName);
  };

  const formatModelDisplayName = (model: string) => {
    const name = model;
    return name;
  };

  return (
    <AIInput onSubmit={handleSubmit} className="bg-inherit">
      <AIInputTextarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What would you like to know?"
        disabled={disabled}
        minHeight={48}
        maxHeight={164}
      />
      <AIInputToolbar>
        <AIInputTools>
          <AIInputModelSelect
            value={selectedModelState}
            onValueChange={handleModelChange}
            disabled={modelsLoading || isError || !ollamaPort}
          >
            <AIInputModelSelectTrigger>
              <AIInputModelSelectValue
                placeholder={
                  modelsLoading
                    ? "Loading models..."
                    : isError
                    ? "Error loading models"
                    : availableModels.length === 0
                    ? "No models found"
                    : "Select a model"
                }
              />
            </AIInputModelSelectTrigger>
            <AIInputModelSelectContent>
              {availableModels.map((model) => (
                <AIInputModelSelectItem key={model} value={model}>
                  {formatModelDisplayName(model)}
                </AIInputModelSelectItem>
              ))}
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
  );
}
