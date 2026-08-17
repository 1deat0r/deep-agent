import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleClient, collectAssistantMessage } from '../src/index.js';
import { fromAny, fromPartial } from '@total-typescript/shoehorn';

/** Capture one request body and reply with a single usage-bearing SSE chunk. */
async function captureBody(
  run: (baseUrl: string, body: () => Record<string, unknown>) => Promise<void>,
): Promise<void> {
  let captured: Record<string, unknown> = {};
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      captured = fromPartial<Record<string, unknown>>(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    await run(`http://127.0.0.1:${fromAny<AddressInfo>(server.address()).port}`, () => captured);
  } finally {
    server.close();
  }
}

describe('reasoningEffort request option', () => {
  it('sends reasoning_effort in the request body when set', async () => {
    await captureBody(async (baseUrl, body) => {
      const client = new OpenAICompatibleClient({ baseUrl, model: 'm' });
      await collectAssistantMessage(client, [{ role: 'user', content: 'hi' }], undefined, {
        reasoningEffort: 'high',
      });
      expect(body().reasoning_effort).toBe('high');
    });
  });

  it('omits reasoning_effort entirely when unset', async () => {
    await captureBody(async (baseUrl, body) => {
      const client = new OpenAICompatibleClient({ baseUrl, model: 'm' });
      await collectAssistantMessage(client, [{ role: 'user', content: 'hi' }]);
      expect('reasoning_effort' in body()).toBe(false);
    });
  });
});
