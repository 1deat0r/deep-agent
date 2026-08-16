import type { ChatMessage, LlmChunk, LlmClient, LlmRequestOptions, ToolDef } from './types.js';

export interface MockCall {
  messages: ChatMessage[];
  tools: ToolDef[] | undefined;
}

/**
 * Deterministic scripted client for tests and offline demos. Each call to
 * `streamChat` consumes the next script in the queue; scripts run out, the
 * client emits a plain empty `done`.
 */
export class MockLlmClient implements LlmClient {
  readonly id = 'mock';
  private queue: LlmChunk[][];
  readonly calls: MockCall[] = [];

  constructor(scripts: LlmChunk[][] = []) {
    this.queue = [...scripts];
  }

  /**
   * Build a client that consumes a shared script array. Several clients (root
   * plus children) can draw from one ordered queue; calls record locally.
   */
  static shared(scripts: LlmChunk[][]): MockLlmClient {
    const client = new MockLlmClient();
    client.queue = scripts;
    return client;
  }

  /** Append a turn script; returns the client for chaining. */
  enqueue(script: LlmChunk[]): this {
    this.queue.push(script);
    return this;
  }

  async *streamChat(
    messages: ChatMessage[],
    tools?: ToolDef[],
    _options?: LlmRequestOptions,
  ): AsyncIterable<LlmChunk> {
    this.calls.push({ messages, tools });
    const script = this.queue.shift();
    if (!script) {
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    for (const chunk of script) yield chunk;
  }
}

/** Script helper: a turn that answers with plain text. */
export function textTurn(content: string, chunks = 1): LlmChunk[] {
  const script: LlmChunk[] = [];
  const size = Math.ceil(content.length / chunks);
  for (let i = 0; i < chunks; i++) {
    script.push({ type: 'delta', content: content.slice(i * size, (i + 1) * size) });
  }
  script.push({ type: 'done', finishReason: 'stop' });
  return script;
}

/** Script helper: a turn that emits one tool call, then (optionally) a final answer turn. */
export function toolCallTurn(
  name: string,
  args: Record<string, unknown>,
  id = `call-${Math.random().toString(36).slice(2, 8)}`,
): LlmChunk[] {
  const json = JSON.stringify(args);
  return [
    { type: 'tool_call_delta', index: 0, id, name, arguments: json.slice(0, 20) },
    {
      type: 'tool_call_delta',
      index: 0,
      id: undefined,
      name: undefined,
      arguments: json.slice(20),
    },
    { type: 'done', finishReason: 'tool_calls' },
  ];
}
