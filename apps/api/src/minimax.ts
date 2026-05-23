export type ContentBlock = { type: "text"; text: string };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicResponse {
  stop_reason: "end_turn" | string;
  content: ContentBlock[];
}

export interface CallMinimaxOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

const RETRY_STATUS_CODES = new Set([401, 429, 500, 502, 503, 520, 529]);
const MAX_RETRIES = 3;

export async function callMinimax(
  messages: AnthropicMessage[],
  systemPrompt: string,
  options: CallMinimaxOptions = {},
): Promise<AnthropicResponse> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error("MINIMAX_API_KEY not set");
  }

  const body = {
    model: options.model ?? process.env.IMPORT_REVIEW_LLM_MODEL ?? process.env.RESOLVER_LLM_MODEL ?? "MiniMax-M2.7",
    temperature: options.temperature ?? Number(process.env.IMPORT_REVIEW_LLM_TEMPERATURE ?? 0.1),
    max_tokens: options.maxTokens ?? Number(process.env.IMPORT_REVIEW_LLM_MAX_TOKENS ?? 2048),
    system: systemPrompt,
    messages,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }

    const response = await fetch("https://api.minimax.io/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json() as Promise<AnthropicResponse>;
    }

    const errorText = await response.text();
    lastError = new Error(`MiniMax request failed: ${response.status} ${errorText}`);
    if (!RETRY_STATUS_CODES.has(response.status)) {
      throw lastError;
    }
  }

  throw lastError ?? new Error("MiniMax request failed");
}

export function extractText(response: AnthropicResponse): string {
  const textBlock = response.content.find((block) => block.type === "text");

  return (textBlock?.text ?? "").replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}
