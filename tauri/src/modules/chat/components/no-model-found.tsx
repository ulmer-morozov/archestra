import { AlertCircle, RefreshCw } from "lucide-react";

interface NoModelFoundProps {
  error: string;
  onRetry: () => void;
}

export function NoModelFound({ error, onRetry }: NoModelFoundProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 bg-destructive/10 border border-destructive/20 rounded-lg">
      <AlertCircle className="h-12 w-12 text-destructive" />

      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-destructive">No Models Available</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {error || "Unable to load any language models. Please check your connection and try again."}
        </p>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 rounded-md transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      )}
    </div>
  );
}
