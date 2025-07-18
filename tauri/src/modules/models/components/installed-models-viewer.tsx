"use client";

import { useState } from "react";
import { RefreshCw, Package, Info, HardDrive } from "lucide-react";

import { useOllamaServer } from "../../chat/contexts/ollama-server-context";
import { useFetchOllamaModels } from "../../chat/hooks/use-fetch-ollama-models";

import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { ScrollArea } from "../../../components/ui/scroll-area";

interface ModelDetails {
  name: string;
  size: number;
  digest: string;
  details: {
    parameter_size: string;
    quantization_level: string;
  };
}

export function InstalledModelsViewer() {
  const [detailedModels, setDetailedModels] = useState<ModelDetails[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const { ollamaPort, isOllamaRunning } = useOllamaServer();
  const { data: installedModels = [], isLoading, refetch } = useFetchOllamaModels({ ollamaPort });

  const fetchDetailedModels = async () => {
    if (!ollamaPort || !isOllamaRunning) return;

    setIsLoadingDetails(true);
    try {
      const response = await fetch(`http://localhost:${ollamaPort}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch detailed models: ${response.status}`);
      }
      const data = await response.json();
      setDetailedModels(data.models || []);
    } catch (error) {
      console.error("Failed to fetch detailed models:", error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const parseModelName = (fullName: string) => {
    const parts = fullName.split(":");
    return {
      name: parts[0],
      tag: parts[1] || "latest",
    };
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            <CardTitle>Currently Installed Models</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchDetailedModels}
              disabled={!isOllamaRunning || isLoadingDetails}
            >
              <Info className="h-4 w-4 mr-2" />
              {isLoadingDetails ? "Loading..." : "Get Details"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!isOllamaRunning || isLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {!isOllamaRunning ? (
          <div className="text-center py-8">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Ollama Server Not Running</h3>
            <p className="text-muted-foreground">Start the Ollama server to view installed models</p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-8">
            <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-4 animate-spin" />
            <p className="text-muted-foreground">Loading installed models...</p>
          </div>
        ) : installedModels.length === 0 ? (
          <div className="text-center py-8">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Models Installed</h3>
            <p className="text-muted-foreground">Download some models from the Model Library to get started</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Total models installed: {installedModels.length}</span>
              {ollamaPort && (
                <Badge variant="outline" className="text-xs">
                  Port: {ollamaPort}
                </Badge>
              )}
            </div>

            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {installedModels.map((modelName, index) => {
                  const { name, tag } = parseModelName(modelName);
                  const detailedModel = detailedModels.find((m) => m.name === modelName);

                  return (
                    <div
                      key={`${modelName}-${index}`}
                      className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{name}</h3>
                            <Badge variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                            {name.includes("qwen") && (
                              <Badge variant="default" className="text-xs bg-blue-600">
                                Qwen
                              </Badge>
                            )}
                          </div>

                          <div className="text-sm text-muted-foreground font-mono">{modelName}</div>

                          {detailedModel && (
                            <div className="flex flex-wrap gap-4 text-sm">
                              <div className="flex items-center gap-1">
                                <HardDrive className="h-3 w-3" />
                                <span>Size: {formatBytes(detailedModel.size)}</span>
                              </div>
                              {detailedModel.details.parameter_size && (
                                <div>
                                  <span className="font-medium">Parameters:</span>{" "}
                                  {detailedModel.details.parameter_size}
                                </div>
                              )}
                              {detailedModel.details.quantization_level && (
                                <div>
                                  <span className="font-medium">Quantization:</span>{" "}
                                  {detailedModel.details.quantization_level}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {detailedModels.length === 0 && (
              <div className="text-center py-4 border-t">
                <p className="text-sm text-muted-foreground mb-2">
                  Click "Get Details" to see model sizes and parameters
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
