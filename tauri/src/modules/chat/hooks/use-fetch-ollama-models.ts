import { useQuery } from "@tanstack/react-query";

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  details: {
    parameter_size: string;
    quantization_level: string;
  };
}

interface IResponse {
  models: OllamaModel[];
}

interface IArgs {
  ollamaPort: number | null;
}

export function useFetchOllamaModels({ ollamaPort }: IArgs) {
  return useQuery({
    queryKey: ["ollama-models", ollamaPort],
    queryFn: async () => {
      const response = await fetch(`http://localhost:${ollamaPort}/api/tags`);

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const data: IResponse = await response.json();
      return data.models?.map((model) => model.name) || [];
    },
    enabled: !!ollamaPort,
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
