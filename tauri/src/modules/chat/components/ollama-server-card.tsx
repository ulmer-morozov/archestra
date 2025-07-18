import { Bot, CheckCircle, XCircle } from "lucide-react";

import { useOllamaServer } from "../contexts/ollama-server-context";

import { Button } from "../../../components/ui/button";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

import { cn } from "../../../lib/utils";

export function OllamaServerCard() {
  const { ollamaStatus, isOllamaRunning, isStarting, isStopping, startOllamaServer, stopOllamaServer } =
    useOllamaServer();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Ollama Local AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {!isOllamaRunning ? (
            <Button onClick={startOllamaServer} disabled={isStarting || isStopping} className="flex items-center gap-2">
              {isStarting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Starting...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Start Ollama Server
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={stopOllamaServer}
              disabled={isStarting || isStopping}
              variant="destructive"
              className="flex items-center gap-2"
            >
              {isStopping ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Stopping...
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  Stop Ollama Server
                </>
              )}
            </Button>
          )}
        </div>

        {ollamaStatus && (
          <Alert
            variant={ollamaStatus.includes("Error") ? "destructive" : "default"}
            className={ollamaStatus.includes("successfully") ? "bg-green-500/10 border-green-500/20" : undefined}
          >
            <AlertDescription className={cn(ollamaStatus.includes("Error") ? "text-destructive" : "text-green-200")}>
              {ollamaStatus}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
