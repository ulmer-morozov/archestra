import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UseOllamaServerReturn {
  ollamaStatus: string;
  isOllamaRunning: boolean;
  ollamaPort: number | null;
  isStarting: boolean;
  isStopping: boolean;
  startError: string | null;
  stopError: string | null;

  startOllamaServer: () => Promise<void>;
  stopOllamaServer: () => Promise<void>;
  setOllamaStatus: (status: string) => void;
}

export function useOllamaServer(onServerStarted?: () => void): UseOllamaServerReturn {
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [isOllamaRunning, setIsOllamaRunning] = useState(false);
  const [ollamaPort, setOllamaPort] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  const startOllamaServer = async () => {
    // Prevent multiple starts
    if (isOllamaRunning) {
      setOllamaStatus("Ollama server is already running");
      return;
    }

    if (isStarting) {
      setOllamaStatus("Ollama server is already starting");
      return;
    }

    try {
      setIsStarting(true);
      setStartError(null);
      setOllamaStatus("Starting Ollama server...");

      const port = await invoke<number>("start_ollama_server");

      setOllamaPort(port);
      setIsOllamaRunning(true);
      setOllamaStatus(`Ollama server started successfully on port ${port}`);

      // Call the callback if provided (for auto-starting MCP servers)
      if (onServerStarted) {
        setTimeout(() => {
          onServerStarted();
        }, 2000);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      const errorMessage = `Error starting Ollama: ${errorMsg}`;

      setOllamaStatus(errorMessage);
      setIsOllamaRunning(false);
      setStartError(errorMessage);
      console.error("Error starting Ollama:", error);
    } finally {
      setIsStarting(false);
    }
  };

  const stopOllamaServer = async () => {
    if (isStopping) {
      setOllamaStatus("Ollama server is already stopping");
      return;
    }

    try {
      setIsStopping(true);
      setStopError(null);
      setOllamaStatus("Stopping Ollama server...");

      await invoke("stop_ollama_server");

      setIsOllamaRunning(false);
      setOllamaPort(null);
      setOllamaStatus("Ollama server stopped");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      const errorMessage = `Error stopping Ollama: ${errorMsg}`;

      setOllamaStatus(errorMessage);
      setStopError(errorMessage);
      console.error("Error stopping Ollama:", error);

      // Even if there's an error, we should reset the state
      setIsOllamaRunning(false);
      setOllamaPort(null);
    } finally {
      setIsStopping(false);
    }
  };

  return {
    // State
    ollamaStatus,
    isOllamaRunning,
    ollamaPort,
    isStarting,
    isStopping,
    startError,
    stopError,

    // Actions
    startOllamaServer,
    stopOllamaServer,
    setOllamaStatus,
  };
}
