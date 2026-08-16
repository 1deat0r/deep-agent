import type { ChatMessage, LlmChunk, LlmClient, LlmRequestOptions, ToolCall, ToolDef } from './types.js';

export interface CollectedResponse {
  message: ChatMessage;
  finishReason: string;
  usage: { promptTokens: number | undefined; completionTokens: number | undefined } | undefined;
}

/**
 * Consumes a streaming chat call and assembles the complete assistant message
 * (content plus fully concatenated tool calls). The first `done` chunk
 * terminates collection; further chunks are ignored.
 */
export async function collectAssistantMessage(
  client: LlmClient,
  messages: ChatMessage[],
  tools?: ToolDef[],
  options?: LlmRequestOptions,
): Promise<CollectedResponse> {
  let content = '';
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason = 'stop';
  let usage: CollectedResponse['usage'];

  for await (const chunk of client.streamChat(messages, tools, options)) {
    switch (chunk.type) {
      case 'delta':
        content += chunk.content;
        break;
      case 'tool_call_delta': {
        const existing = toolCalls.get(chunk.index);
        if (existing) {
          if (chunk.id) existing.id = chunk.id;
          if (chunk.name) existing.name += chunk.name;
          if (chunk.arguments) existing.arguments += chunk.arguments;
        } else {
          toolCalls.set(chunk.index, {
            id: chunk.id ?? '',
            name: chunk.name ?? '',
            arguments: chunk.arguments ?? '',
          });
        }
        break;
      }
      case 'done':
        finishReason = chunk.finishReason;
        usage = chunk.usage;
        return { message: finalizeMessage(content, toolCalls), finishReason, usage };
      case 'error':
        throw new Error(chunk.message);
    }
  }

  return { message: finalizeMessage(content, toolCalls), finishReason, usage };
}

function finalizeMessage(
  content: string,
  toolCalls: Map<number, { id: string; name: string; arguments: string }>,
): ChatMessage {
  const calls: ToolCall[] = [...toolCalls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    }));
  return {
    role: 'assistant',
    content: content === '' ? null : content,
    ...(calls.length > 0 ? { tool_calls: calls } : {}),
  };
}

/** Convenience: a single self-contained chunk script for a mock turn. */
export type MockScript = LlmChunk[];
