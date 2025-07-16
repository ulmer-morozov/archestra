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
} from "@/components/kibo/ai-input";
import { PaperclipIcon, MicIcon } from "lucide-react";

interface SimpleChatInputProps {
  onSubmit: (message: string) => Promise<void>;
  disabled?: boolean;
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

export function ChatInput({ onSubmit, disabled = false }: SimpleChatInputProps) {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"submitted" | "streaming" | "ready" | "error">("ready");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Fetch available Ollama models
  useEffect(() => {
    const fetchModels = async () => {
      try {
        setModelsLoading(true);
        setModelsError(null);

        const response = await fetch("http://localhost:11434/api/tags");

        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.status}`);
        }

        const data: OllamaResponse = await response.json();
        setModels(data.models);

        // Set the first model as default if available
        if (data.models.length > 0 && !selectedModel) {
          setSelectedModel(data.models[0].name);
        }
      } catch (error) {
        console.error("Error fetching Ollama models:", error);
        setModelsError("Failed to fetch local models. Make sure Ollama is running.");
        // Fallback to some default models
        setModels([
          {
            name: "llama3.2",
            modified_at: "",
            size: 0,
            digest: "",
            details: {
              format: "gguf",
              family: "llama",
              parameter_size: "3B",
              quantization_level: "Q4_0",
            },
          },
        ]);
        setSelectedModel("llama3.2");
      } finally {
        setModelsLoading(false);
      }
    };

    fetchModels();
  }, [selectedModel]);

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

  const formatModelDisplayName = (model: OllamaModel) => {
    const name = model.name;
    const paramSize = model.details.parameter_size;
    return paramSize ? `${name} (${paramSize})` : name;
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
            <AIInputModelSelect
              value={selectedModel}
              onValueChange={setSelectedModel}
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
    </div>
  );
}
