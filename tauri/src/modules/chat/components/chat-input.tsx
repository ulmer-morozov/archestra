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
import { NoModelFound } from "./no-model-found";

interface SimpleChatInputProps {
  onSubmit: (message: string, model: string) => Promise<void>;
  onModelChange?: (modelName: string) => void;
  disabled?: boolean;
  ollamaPort?: number | null;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaResponse {
  models: OllamaModel[];
}

export function ChatInput({ onSubmit, onModelChange, disabled = false, ollamaPort }: SimpleChatInputProps) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"submitted" | "streaming" | "ready" | "error">("ready");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");

  const fetchModels = async () => {
    try {
      setModelsLoading(true);
      setModelsError(null);

      const port = ollamaPort || 11434;
      const response = await fetch(`http://localhost:${port}/api/tags`);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data: OllamaResponse = await response.json();
      setModels(data.models);
      if (data.models.length > 0 && !selectedModel) {
        setSelectedModel(data.models[0].name);
      }
    } catch (error) {
      console.error("Error fetching Ollama models:", error);
      setModelsError("Failed to fetch local models. Make sure Ollama is running.");
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    if (ollamaPort) {
      fetchModels();
    }
  }, [selectedModel, ollamaPort]);

  const handleSubmit = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) {
      e.preventDefault();
    }

    if (!message.trim() || disabled || !selectedModel) {
      return;
    }

    setStatus("submitted");

    try {
      await onSubmit(message.trim(), selectedModel);
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

  const formatModelDisplayName = (model: OllamaModel) => {
    const name = model.name;
    const paramSize = model.details.parameter_size;
    return paramSize ? `${name} (${paramSize})` : name;
  };

  if (modelsError || (!modelsLoading && models.length === 0)) {
    return (
      <div className="m-3">
        <NoModelFound
          error={modelsError || "No models found. Please ensure Ollama is running and has models installed."}
          onRetry={fetchModels}
        />
      </div>
    );
  }

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
            value={selectedModel}
            onValueChange={handleModelChange}
            disabled={modelsLoading || modelsError !== null}
          >
            <AIInputModelSelectTrigger>
              <AIInputModelSelectValue
                placeholder={
                  modelsLoading
                    ? "Loading models..."
                    : modelsError
                    ? "Error loading models"
                    : models.length === 0
                    ? "No models found"
                    : "Select a model"
                }
              />
            </AIInputModelSelectTrigger>
            <AIInputModelSelectContent>
              {models.map((model) => (
                <AIInputModelSelectItem key={model.name} value={model.name}>
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
