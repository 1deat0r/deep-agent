import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MockLlmClient,
  OpenAICompatibleClient,
  collectAssistantMessage,
  textTurn,
  toolCallTurn,
} from '../src/index.js';

function sseServer(handler: (body: string) => string | string[]): Server {
  return createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const chunks = handler(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of chunks) res.write(chunk);
      res.end();
    });
  });
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = sseServer((body) => {
    const parsed = JSON.parse(body) as { messages: unknown[]; tools?: unknown[] };
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'Hel' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'ipy', arguments: '' } }], finish_reason: null } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'thon', arguments: '' } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }], finish_reason: 'tool_calls' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    // Sanity: the request really did carry what we sent.
    if (parsed.messages.length === 0 || parsed.tools?.length === 0) {
      return ['data: {"error":{"message":"bad request"}}\n\n'];
    }
    return lines;
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => void server.close());

describe('OpenAICompatibleClient', () => {
  it('parses deltas, assembles tool calls, and reports usage', async () => {
    const client = new OpenAICompatibleClient({ baseUrl, model: 'test-model' });
    const result = await collectAssistantMessage(
      client,
      [{ role: 'user', content: 'hi' }],
      [{ type: 'function', function: { name: 'ipython', description: '', parameters: {} } }],
    );
    expect(result.message.content).toBe('Hello');
    expect(result.message.tool_calls).toHaveLength(1);
    expect(result.message.tool_calls?.[0]).toMatchObject({
      id: 't1',
      function: { name: 'ipython', arguments: '{"a":' },
    });
    expect(result.finishReason).toBe('tool_calls');
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 3 });
  });

  it('surfaces provider errors as thrown errors', async () => {
    const server2 = sseServer(() => ['data: {"error":{"message":"boom"}}\n\n']);
    await new Promise<void>((resolve) => server2.listen(0, resolve));
    const url = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    try {
      const client = new OpenAICompatibleClient({ baseUrl: url, model: 'm' });
      await expect(
        collectAssistantMessage(client, [{ role: 'user', content: 'x' }]),
      ).rejects.toThrow('boom');
    } finally {
      server2.close();
    }
  });

  it('returns HTTP errors with body detail', async () => {
    const server2 = createServer((_req, res) => {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('bad key');
    });
    await new Promise<void>((resolve) => server2.listen(0, resolve));
    const url = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    try {
      const client = new OpenAICompatibleClient({ baseUrl: url, model: 'm' });
      await expect(
        collectAssistantMessage(client, [{ role: 'user', content: 'x' }]),
      ).rejects.toThrow(/401/);
    } finally {
      server2.close();
    }
  });

  it('synthesizes done when a provider omits the stop chunk', async () => {
    const server2 = sseServer(() => [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'bare' } }] })}\n\n`,
    ]);
    await new Promise<void>((resolve) => server2.listen(0, resolve));
    const url = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    try {
      const client = new OpenAICompatibleClient({ baseUrl: url, model: 'm' });
      const result = await collectAssistantMessage(client, [{ role: 'user', content: 'x' }]);
      expect(result.message.content).toBe('bare');
      expect(result.finishReason).toBe('stop');
    } finally {
      server2.close();
    }
  });
});

describe('MockLlmClient', () => {
  it('replays scripts in order and records calls', async () => {
    const mock = new MockLlmClient([
      textTurn('first'),
      toolCallTurn('ipython', { code: '1+1' }),
      textTurn('third'),
    ]);
    const first = await collectAssistantMessage(mock, [{ role: 'user', content: 'a' }]);
    expect(first.message.content).toBe('first');
    const second = await collectAssistantMessage(mock, [{ role: 'user', content: 'b' }]);
    expect(second.message.tool_calls?.[0]?.function.name).toBe('ipython');
    expect(JSON.parse(second.message.tool_calls?.[0]?.function.arguments ?? '{}')).toEqual({
      code: '1+1',
    });
    const third = await collectAssistantMessage(mock, [{ role: 'user', content: 'c' }]);
    expect(third.message.content).toBe('third');
    expect(mock.calls).toHaveLength(3);
    expect(mock.calls[0]?.messages[0]).toEqual({ role: 'user', content: 'a' });
  });
});
