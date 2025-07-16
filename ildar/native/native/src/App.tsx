import { useState } from "react";
import { Button } from "@/components/ui/button";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { error as logError } from "@tauri-apps/plugin-log";
import { homeDir } from "@tauri-apps/api/path";
import { ProfileForm } from "@/components/profile-form";

interface FileConfig {
  id: string;
  name: string;
  path: string;
  baseDir?: BaseDirectory;
  isRelativePath?: boolean;
}

function App() {
  const [fileContents, setFileContents] = useState<Record<string, string>>({});

  const configFiles: FileConfig[] = [
    {
      id: "mcp",
      name: "Cursor MCP Config",
      path: ".cursor/mcp.json",
      baseDir: BaseDirectory.Home,
    },
    {
      id: "claude",
      name: "Claude Config",
      path: "Library/Application Support/Claude/claude_desktop_config.json",
      isRelativePath: true,
    },
  ];



  async function loadFileContent(fileConfig: FileConfig) {
    try {
      let content: string;

      if (fileConfig.baseDir) {
        content = await readTextFile(fileConfig.path, {
          baseDir: fileConfig.baseDir,
        });
      } else if (fileConfig.isRelativePath) {
        const home = await homeDir();
        const fullPath = `${home}${fileConfig.path}`;
        content = await readTextFile(fullPath);
      } else {
        content = await readTextFile(fileConfig.path);
      }

      setFileContents((prev) => ({ ...prev, [fileConfig.id]: content }));
    } catch (e) {
      const errorMsg = `Could not read ${fileConfig.path} ${e instanceof Error ? e.message : String(e)}`;
      logError(
        `Failed to read ${fileConfig.path}: ${e instanceof Error ? e.message : String(e)}`,
      );
      setFileContents((prev) => ({ ...prev, [fileConfig.id]: errorMsg }));
    }
  }

  async function loadAllFiles() {
    for (const fileConfig of configFiles) {
      await loadFileContent(fileConfig);
    }
  }

  return (
    <main className="font-sans min-h-screen flex flex-col items-center px-4">
      <h1 className="text-2xl font-semibold mb-6 text-center">
        Run MCP Server Containers
      </h1>
      <ProfileForm />

      <Button
        onClick={loadAllFiles}
        className="mt-4 px-4 py-2 text-sm font-medium rounded bg-purple-600 hover:bg-purple-500 text-white"
      >
        Load All Config Files
      </Button>

      {configFiles.map((fileConfig) => (
        <div key={fileConfig.id} className="w-full max-w-2xl mt-4">
          <div className="flex gap-2 items-center mb-2">
            <Button
              onClick={() => loadFileContent(fileConfig)}
              className="px-4 py-2 text-sm font-medium rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              Load {fileConfig.name}
            </Button>
          </div>
          <pre className="bg-gray-100 p-2 rounded text-xs w-full overflow-x-auto">
            {fileContents[fileConfig.id] || `${fileConfig.name} not loaded`}
          </pre>
        </div>
      ))}
    </main>
  );
}

export default App;
