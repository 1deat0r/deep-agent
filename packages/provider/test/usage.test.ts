import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleClient, collectAssistantMessage } from '../src/index.js';
import { fromAny, fromPartial } from '@total-typescript/shoehorn';

/** Serve one SSE response whose final usage chunk is `usage` (or a whole line override). */
async function withServer(lines: string[], run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const chunk of lines) res.write(chunk);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    await run(`http://127.0.0.1:${fromAny<AddressInfo>(server.address()).port}`);
  } finally {
    server.close();
  }
}

function usageLines(usage: Record<string, unknown>): string[] {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'Hi' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage })}\n\n`,
    'data: [DONE]\n\n',
  ];
}

describe('usage normalization', () => {
  it('reports OpenAI-style cached prompt tokens as cache hit + derived miss', async () => {
    await withServer(
      usageLines({
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 100 },
      }),
      async (baseUrl) => {
        const client = new OpenAICompatibleClient({ baseUrl, model: 'm' });
        const result = await collectAssistantMessage(client, [{ role: 'user', content: 'hi' }]);
        expect(result.usage).toMatchObject({
          promptTokens: 120,
          completionTokens: 30,
          cacheHitTokens: 100,
          cacheMissTokens: 20,
        });
      },
    );
  });

  it('reports DeepSeek-style prompt cache hit/miss tokens directly', async () => {
    await withServer(
      usageLines({
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_cache_hit_tokens: 90,
        prompt_cache_miss_tokens: 30,
      }),
      async (baseUrl) => {
        const client = new OpenAICompatibleClient({ baseUrl, model: 'm' });
        const result = await collectAssistantMessage(client, [{ role: 'user', content: 'hi' }]);
        expect(result.usage).toMatchObject({
          promptTokens: 120,
          completionTokens: 30,
          cacheHitTokens: 90,
          cacheMissTokens: 30,
        });
      },
    );
  });

  it('keeps plain usage without cache fields (no undefined keys)', async () => {
    await withServer(
      usageLines({ prompt_tokens: 11, completion_tokens: 3 }),
      async (baseUrl) => {
        const client = new OpenAICompatibleClient({ baseUrl, model: 'm' });
        const result = await collectAssistantMessage(client, [{ role: 'user', content: 'hi' }]);
        expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 3 });
      },
    );
  });
});
