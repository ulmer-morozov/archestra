import { useState, useEffect } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
// import { invoke } from "@tauri-apps/api/core";
import { Command } from '@tauri-apps/plugin-shell';
import "./App.css";

function App() {
  const [greetingMessage, setGreetingMessage] = useState("");
  const [greetingMessageError, setGreetingMessageError] = useState("");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
  // const [sidecarMsg, setSidecarMsg] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState("");
  const [ollamaResponse, setOllamaResponse] = useState("");

  // Fetch the port from Rust on mount
  useEffect(() => {
    invoke<number>("get_hello_server_port").then(setSidecarPort);
  }, []);

  // async function greet() {
  //   // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  //   setGreetMsg(await invoke("greet", { name }));
  // }

  async function greetingFromNodeSidecarServer() {
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:${sidecarPort}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: name }),
      });
      const data = await response.json();
      if (response.ok) {
        setGreetingMessage(data.message);
      } else {
        setGreetingMessageError(data.message);
      }
    } catch (error) {
      setGreetingMessageError(error instanceof Error ? error.message : 'An unknown error occurred');
    }

    setLoading(false);
  }

  async function runOllamaServe() {
    try {
      setOllamaStatus("Starting Ollama server...");
      console.log("Attempting to start Ollama sidecar...");
      
      const command = Command.sidecar('binaries/ollama-darwin/ollama', ['serve']);
      console.log("Command created, executing...");
      
      const output = await command.execute();
      console.log("Command executed, output:", output);
      
      if (output.code === 0) {
        setOllamaStatus(`Ollama server started successfully. stdout: ${output.stdout}`);
      } else {
        setOllamaStatus(`Ollama server failed with code ${output.code}. stderr: ${output.stderr}, stdout: ${output.stdout}`);
      }
    } catch (error) {
      console.error("Error in runOllamaServe:", error);
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
      setOllamaStatus(`Error starting Ollama: ${errorMsg}`);
    }
  }

  async function callOllamaAPI() {
    try {
      setOllamaResponse("Calling Ollama API...");
      const response = await fetch('http://localhost:11434/api/tags');
      const data = await response.json();
      
      if (response.ok) {
        setOllamaResponse(JSON.stringify(data, null, 2));
      } else {
        setOllamaResponse(`Error: ${response.status} - ${response.statusText}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      setOllamaResponse(`Error calling Ollama API: ${errorMsg}`);
    }
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vitejs.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://reactjs.org" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greetingFromNodeSidecarServer();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter your name..."
        />
        {/* Port is now set automatically from Rust */}
        <button type="submit" disabled={loading || sidecarPort === null}>
          {loading ? "Loading..." : "Greet"}
        </button>
      </form>
      <p>hello-server port: {sidecarPort ?? 'loading...'}</p>
      <p>node.js server response: {greetingMessage}</p>
      <p>node.js server error: {greetingMessageError}</p>
      
      <div className="row">
        <button onClick={runOllamaServe}>
          Start Ollama Server
        </button>
      </div>
      <p>Ollama status: {ollamaStatus}</p>
      
      <div className="row">
        <button onClick={callOllamaAPI}>
          Call Ollama API
        </button>
      </div>
      <p>Ollama API response: {ollamaResponse}</p>
      
    </main>
  );
}

export default App;
