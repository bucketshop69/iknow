export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface AnthropicResponse {
  stop_reason: "end_turn" | "tool_use" | string;
  content: ContentBlock[];
}

export interface CallMinimaxOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

const TOKEN_WARN_THRESHOLD = 40_000;
const RETRY_STATUS_CODES = new Set([401, 429, 500, 502, 503, 520, 529]);
const MAX_RETRIES = 5;

export function estimateTokens(messages: AnthropicMessage[], systemPrompt: string): number {
  const systemChars = systemPrompt.length;
  const messageChars = messages.reduce((sum, message) => {
    if (typeof message.content === "string") {
      return sum + message.content.length;
    }

    return (
      sum +
      message.content.reduce((innerSum, block) => {
        if (block.type === "text") return innerSum + block.text.length;
        if (block.type === "tool_use") return innerSum + JSON.stringify(block.input).length;
        if (block.type === "tool_result") return innerSum + block.content.length;
        return innerSum;
      }, 0)
    );
  }, 0);

  return Math.ceil((systemChars + messageChars) / 4);
}

export async function callMinimax(
  messages: AnthropicMessage[],
  systemPrompt: string,
  options: CallMinimaxOptions = {},
): Promise<AnthropicResponse> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not set");

  const estimatedTokens = estimateTokens(messages, systemPrompt);
  if (estimatedTokens > TOKEN_WARN_THRESHOLD) {
    console.warn(`[minimax] Large context warning: ~${estimatedTokens.toLocaleString()} tokens before LLM call`);
  }

  const body = {
    model: options.model ?? process.env.RESOLVER_LLM_MODEL ?? "MiniMax-M2.7",
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 4096,
    system: systemPrompt,
    messages,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      const jitter = Math.floor(Math.random() * 2_000);
      const delayMs = 2_000 * Math.pow(2, attempt - 1) + jitter;
      console.warn(`[minimax] Retry ${attempt}/${MAX_RETRIES - 1} after ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
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

    console.warn(`[minimax] Retryable error: ${response.status} ${errorText.slice(0, 120)}`);
  }

  throw lastError ?? new Error("MiniMax request failed");
}

export function extractText(response: AnthropicResponse): string {
  const textBlock = response.content.find((block) => block.type === "text") as
    | Extract<ContentBlock, { type: "text" }>
    | undefined;

  return (textBlock?.text ?? "").replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}
