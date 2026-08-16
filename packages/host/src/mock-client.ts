import type { ChatMessage, LlmChunk, LlmClient, LlmRequestOptions, ToolDef } from '@deep-agent/provider';

/**
 * Offline demo client for the mock provider profile: echoes the last user
 * message so the whole harness can be exercised without an API key.
 */
export class EchoLlmClient implements LlmClient {
  readonly id = 'mock';

  async listModels(): Promise<string[]> {
    return ['mock-model'];
  }

  async *streamChat(
    messages: ChatMessage[],
    _tools?: ToolDef[],
    _options?: LlmRequestOptions,
  ): AsyncIterable<LlmChunk> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const snippet = (lastUser?.content ?? '').slice(0, 120);
    const content =
      `This is the mock provider. I received: "${snippet}".\n\n` +
      `Configure a real OpenAI-compatible endpoint (e.g. DeepSeek) in Settings — this host is ` +
      `fully wired: one persistent ipython kernel, rlm() subagents, and goals are ready.`;
    for (let i = 0; i < content.length; i += 24) {
      yield { type: 'delta', content: content.slice(i, i + 24) };
    }
    yield { type: 'done', finishReason: 'stop' };
  }
}
