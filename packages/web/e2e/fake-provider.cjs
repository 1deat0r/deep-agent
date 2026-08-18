// Fake OpenAI-compatible SSE provider for e2e: deterministic replies with
// usage (DeepSeek-style cache hit/miss) so the full loop is exercised.
const http = require('node:http');

const MODEL = 'fake-pro';

function sse(res, lines) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  for (const line of lines) res.write(`data: ${JSON.stringify(line)}\n\n`);
  res.end('data: [DONE]\n\n');
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/models' || req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            { id: 'fake-flash' },
            { id: 'fake-pro' },
            { id: 'unrated-fake' }, // no wallet rate — must be filtered by the host
          ],
        }),
      );
      return;
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      const body = JSON.parse(raw || '{}');
      const last = (body.messages || []).filter((m) => m.role === 'user').at(-1);
      const text = (last?.content || '').trim();
      const wantTool = text.includes('write a file');
      if (wantTool) {
        sse(res, [
          {
            choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'ipython', arguments: '{"code":"42"}' } }] } }],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
          { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } },
        ]);
        return;
      }
      sse(res, [
        { choices: [{ delta: { role: 'assistant', content: 'Hello from' } }] },
        { choices: [{ delta: { content: ' the fake provider.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        {
          choices: [],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 40,
            prompt_cache_hit_tokens: 800,
            prompt_cache_miss_tokens: 400,
          },
        },
      ]);
      return;
    }
    res.writeHead(404).end();
  });
});

server.listen(3990, '127.0.0.1', () => {
  process.stdout.write('fake-provider: listening on 3990\n');
});
