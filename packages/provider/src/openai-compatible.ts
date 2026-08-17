import type { ChatMessage, LlmChunk, LlmClient, LlmRequestOptions, ToolDef } from './types.js';

export interface OpenAICompatibleConfig {
  /** Base URL, e.g. https://api.deepseek.com (no trailing /v1 needed if endpoint is /chat/completions). */
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string;
  temperature: number | undefined;
  maxTokens: number | undefined;
  defaultHeaders: Record<string, string> | undefined;
}

interface SseChoiceDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  finish_reason?: string | null;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function modelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (/\/models$/.test(trimmed)) return trimmed;
  if (/\/chat\/completions$/.test(trimmed)) return trimmed.replace(/\/chat\/completions$/, '/models');
  if (/\/v\d+$/.test(trimmed)) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

function processChunks(
  chunks: LlmChunk[],
  step: (chunk: LlmChunk) => LlmChunk[],
): LlmChunk[] {
  const out: LlmChunk[] = [];
  for (const chunk of chunks) out.push(...step(chunk));
  return out;
}

/**
 * Streaming client for any OpenAI-compatible chat-completions endpoint
 * (DeepSeek, OpenAI, vLLM, Ollama, LM Studio, ...). Hand-rolled on fetch so the
 * package stays dependency-free; tolerates minor spec deviations seen across
 * providers (null content, missing usage, empty final chunks).
 */
export class OpenAICompatibleClient implements LlmClient {
  readonly id = 'openai-compatible';
  readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
  }

  /** Model ids the endpoint exposes. */
  async listModels(): Promise<string[]> {
    const baseUrl = this.config.baseUrl ?? 'https://api.deepseek.com';
    const apiKey = this.config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
    const response = await fetch(modelsUrl(baseUrl), {
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        ...this.config.defaultHeaders,
      },
    });
    if (!response.ok) {
      throw new Error(`provider models call returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { data?: { id?: string }[] };
    return (body.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string')
      .sort();
  }

  async *streamChat(
    messages: ChatMessage[],
    tools?: ToolDef[],
    options?: LlmRequestOptions,
  ): AsyncIterable<LlmChunk> {
    const baseUrl = this.config.baseUrl ?? 'https://api.deepseek.com';
    const apiKey = this.config.apiKey ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY;
    const url = chatCompletionsUrl(baseUrl);

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: options?.temperature ?? this.config.temperature ?? 0.3,
    };
    if (tools && tools.length > 0) body.tools = tools;
    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    if (options?.reasoningEffort !== undefined) body.reasoning_effort = options.reasoningEffort;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...this.config.defaultHeaders,
          ...options?.headers,
        },
        body: JSON.stringify(body),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', message: `provider request failed: ${message}` };
      return;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      yield {
        type: 'error',
        message: `provider returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: 'error', message: 'provider returned an empty response body' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleLine = (rawLine: string): LlmChunk[] => {
      const line = rawLine.trim();
      if (!line || line.startsWith(':')) return [];
      if (!line.startsWith('data:')) return [];
      const data = line.slice(5).trim();
      if (data === '[DONE]') return [];
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return [{ type: 'error', message: `provider sent malformed JSON: ${data.slice(0, 200)}` }];
      }

      if (typeof parsed.error === 'object' && parsed.error !== null) {
        const err = parsed.error as { message?: string };
        return [{ type: 'error', message: `provider stream error: ${err.message ?? 'unknown'}` }];
      }

      const usageRaw = parsed.usage as
        | {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            prompt_cache_hit_tokens?: number;
            prompt_cache_miss_tokens?: number;
          }
        | undefined;
      if (usageRaw) {
        // Normalize the two prompt-cache wire shapes. DeepSeek reports a
        // hit/miss split directly; OpenAI reports only cached tokens inside
        // prompt_tokens_details (miss = prompt - cached).
        let cacheHitTokens: number | undefined;
        let cacheMissTokens: number | undefined;
        if (
          typeof usageRaw.prompt_cache_hit_tokens === 'number' ||
          typeof usageRaw.prompt_cache_miss_tokens === 'number'
        ) {
          cacheHitTokens = usageRaw.prompt_cache_hit_tokens;
          cacheMissTokens = usageRaw.prompt_cache_miss_tokens;
        } else if (typeof usageRaw.prompt_tokens_details?.cached_tokens === 'number') {
          cacheHitTokens = usageRaw.prompt_tokens_details.cached_tokens;
          if (typeof usageRaw.prompt_tokens === 'number') {
            cacheMissTokens = usageRaw.prompt_tokens - cacheHitTokens;
          }
        }
        return [
          {
            type: 'done',
            finishReason: 'stop',
            usage: {
              promptTokens: usageRaw.prompt_tokens,
              completionTokens: usageRaw.completion_tokens,
              ...(cacheHitTokens !== undefined ? { cacheHitTokens } : {}),
              ...(cacheMissTokens !== undefined ? { cacheMissTokens } : {}),
            },
          },
        ];
      }

      const choices = (parsed.choices ?? []) as Array<{ delta?: SseChoiceDelta }>;
      if (choices.length === 0) return [];
      const delta = choices[0]?.delta;
      if (!delta) return [];

      const chunks: LlmChunk[] = [];
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        chunks.push({ type: 'delta', content: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        chunks.push({
          type: 'tool_call_delta',
          index: tc.index ?? 0,
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        });
      }
      if (delta.finish_reason) {
        chunks.push({ type: 'done', finishReason: delta.finish_reason });
      }
      return chunks;
    };

    let emittedDone = false;
    // A `finish_reason` chunk precedes the usage chunk on the wire; hold the
    // done chunk so usage can merge into it.
    let pendingDone: Extract<LlmChunk, { type: 'done' }> | null = null;
    const step = (chunk: LlmChunk): LlmChunk[] => {
      if (pendingDone) {
        if (chunk.type === 'done' && chunk.usage) {
          const merged = { ...pendingDone, usage: chunk.usage };
          pendingDone = null;
          return [merged];
        }
        const flushed = pendingDone;
        pendingDone = null;
        return [flushed, ...step(chunk)];
      }
      if (chunk.type === 'done' && !chunk.usage) {
        pendingDone = chunk;
        return [];
      }
      return [chunk];
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          for (const chunk of processChunks(handleLine(line), step)) {
            if (chunk.type === 'done') emittedDone = true;
            yield chunk;
          }
        }
      }
      buffer += decoder.decode();
      const leftover = buffer.trim();
      if (leftover) {
        for (const chunk of processChunks(handleLine(leftover), step)) {
          if (chunk.type === 'done') emittedDone = true;
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (pendingDone) {
      emittedDone = true;
      yield pendingDone;
    }
    if (!emittedDone) {
      // Some providers omit the final stop chunk entirely; synthesize one so
      // collectors always terminate.
      yield { type: 'done', finishReason: 'stop' };
    }
  }
}
