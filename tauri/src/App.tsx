import { useState, useEffect } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [greetingMessage, setGreetingMessage] = useState("");
  const [greetingMessageError, setGreetingMessageError] = useState("");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
  // const [sidecarMsg, setSidecarMsg] = useState("");

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
    </main>
  );
}

export default App;
