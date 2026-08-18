export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmUsage {
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  /** Prompt tokens served from the provider's prompt cache (OpenAI/DeepSeek). */
  cacheHitTokens?: number;
  /** Prompt tokens that missed the cache (DeepSeek reports these; OpenAI derives them). */
  cacheMissTokens?: number;
}

export type LlmChunk =
  | { type: 'delta'; content: string }
  | {
      type: 'tool_call_delta';
      index: number;
      id: string | undefined;
      name: string | undefined;
      arguments: string | undefined;
    }
  | { type: 'done'; finishReason: string; usage?: LlmUsage }
  | { type: 'error'; message: string };

export interface LlmRequestOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Extra headers merged over defaults (e.g. per-request overrides). */
  headers?: Record<string, string>;
  /**
   * Explicit reasoning effort (DeepSeek v4: low/high/max; OpenAI o-series:
   * minimal/low/medium/high). Sent as `reasoning_effort` in the request body
   * only when set, so providers that don't support it never see the field.
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';
}

export interface LlmClient {
  readonly id: string;
  streamChat(
    messages: ChatMessage[],
    tools?: ToolDef[],
    options?: LlmRequestOptions,
  ): AsyncIterable<LlmChunk>;
  /** Model ids the endpoint exposes (for the GUI picker). */
  listModels(): Promise<string[]>;
}
