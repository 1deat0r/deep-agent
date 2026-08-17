import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { AgentManager } from './manager.js';
import { ssePayload } from './events.js';
import type { HostConfig, ModelsResponse } from './types.js';
import { Wallet } from './wallet.js';
import { ApprovalError, ApprovalRegistry } from './approvals.js';

const VERSION = '0.1.0';

function defaultWebDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'packages', 'web', 'dist');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (raw.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`invalid JSON body: ${(error as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

/**
 * Security baseline for the served GUI (desktop-shell ticket 05). The built
 * GUI has no inline scripts, so `script-src 'self'` holds.
 */
export const GUI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; font-src 'self'; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function serveStatic(res: ServerResponse, webDir: string, pathname: string): void {
  const safe = pathname.replaceAll('..', '').replace(/^\/+/, '');
  let filePath = join(webDir, safe === '' ? 'index.html' : safe);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    filePath = join(webDir, 'index.html');
  }
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: `web UI not built (missing ${webDir})` });
    return;
  }
  const type = MIME[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-security-policy': GUI_CSP });
  createReadStream(filePath).pipe(res);
}

export interface ServerOptions {
  config: HostConfig;
  manager: AgentManager;
  webDir?: string;
  wallet: Wallet;
  approvals: ApprovalRegistry;
}

export class HostServer {
  readonly config: HostConfig;
  private readonly manager: AgentManager;
  private readonly wallet: Wallet;
  private readonly approvals: ApprovalRegistry;
  private readonly webDir: string;
  private server: Server | null = null;

  constructor(options: ServerOptions) {
    this.config = options.config;
    this.manager = options.manager;
    this.wallet = options.wallet;
    this.approvals = options.approvals;
    this.webDir = options.webDir ?? process.env.DEEP_AGENT_WEB_DIR ?? defaultWebDir();
  }

  async start(): Promise<{ port: number; host: string }> {
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        if (!res.headersSent) {
          sendJson(res, 500, { error: (error as Error).message });
        } else {
          res.end();
        }
      });
    });
    this.server = server;
    await new Promise<void>((resolve) => {
      server.listen(this.config.port, this.config.host, resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : this.config.port;
    return { port, host: this.config.host };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
      this.server?.closeAllConnections();
    });
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: VERSION });
      return;
    }
    if (pathname === '/api/skills') {
      sendJson(res, 200, {
        dir: this.manager.skills.dir,
        skills: this.manager.skills.list(),
      });
      return;
    }
    if (pathname === '/api/models' && req.method === 'GET') {
      try {
        const client = this.manager.createClient({ role: 'root', model: this.config.provider.model });
        const models: ModelsResponse = { models: await client.listModels(), default: this.config.provider.model };
        sendJson(res, 200, models);
      } catch (error) {
        const models: ModelsResponse = {
          models: [this.config.provider.model],
          default: this.config.provider.model,
          error: (error as Error).message,
        };
        sendJson(res, 200, models);
      }
      return;
    }
    if (pathname === '/api/config') {
      const { provider } = this.config;
      sendJson(res, 200, {
        port: this.config.port,
        host: this.config.host,
        dataDir: this.config.dataDir,
        maxDepth: this.config.maxDepth,
        maxToolIterations: this.config.maxToolIterations,
        maxAutoRounds: this.config.maxAutoRounds,
        execTimeoutMs: this.config.execTimeoutMs,
        provider: {
          id: provider.id,
          baseUrl: provider.baseUrl,
          model: provider.model,
          temperature: provider.temperature,
          maxTokens: provider.maxTokens,
          hasApiKey: Boolean(provider.apiKey),
        },
      });
      return;
    }

    if (pathname === '/api/wallet') {
      sendJson(res, 200, {
        budgetUsd: this.config.wallet.budgetUsd,
        spentUsd: this.wallet.spentUsd(),
        remainingUsd: this.wallet.remainingUsd(),
        rates: this.config.wallet.rates,
      });
      return;
    }

    if (pathname === '/api/approvals' && req.method === 'GET') {
      sendJson(res, 200, { approvals: this.approvals.pending() });
      return;
    }
    const approvalMatch = pathname.match(/^\/api\/approvals\/([0-9a-zA-Z-]+)$/);
    if (approvalMatch && req.method === 'POST') {
      const body = await readJson(req);
      const approved = body.approve === true;
      if (body.approve !== true && body.approve !== false) {
        sendJson(res, 400, { error: 'approve must be a boolean' });
        return;
      }
      try {
        const approval = this.manager.decideApproval(
          approvalMatch[1] ?? '',
          approved,
          typeof body.note === 'string' ? body.note : '',
        );
        sendJson(res, 200, { approval });
      } catch (error) {
        if (error instanceof ApprovalError) {
          sendJson(res, 404, { error: error.message });
        } else {
          sendJson(res, 500, { error: (error as Error).message });
        }
      }
      return;
    }

    if (pathname === '/api/sessions' && req.method === 'GET') {
      sendJson(res, 200, { sessions: this.manager.list() });
      return;
    }
    if (pathname === '/api/sessions' && req.method === 'POST') {
      const body = await readJson(req);
      const session = await this.manager.createSession({
        title: typeof body.title === 'string' ? body.title : undefined,
        goal: typeof body.goal === 'string' && body.goal !== '' ? body.goal : null,
        autoContinue: undefined,
        model:
          typeof body.model === 'string' && body.model.trim() !== '' ? body.model.trim() : undefined,
      });
      sendJson(res, 201, { meta: session.meta });
      return;
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([0-9a-f-]+)(\/.*)?$/);
    if (!sessionMatch) {
      if (req.method === 'GET') {
        serveStatic(res, this.webDir, pathname);
      } else {
        sendJson(res, 404, { error: `no route for ${req.method} ${pathname}` });
      }
      return;
    }
    const sessionId = sessionMatch[1] ?? '';
    const rest = sessionMatch[2] ?? '';
    const session = this.manager.get(sessionId);

    if (rest === '' || rest === '/') {
      if (req.method === 'GET') {
        if (!session) {
          sendJson(res, 404, { error: 'session not found' });
          return;
        }
        sendJson(res, 200, {
          meta: session.meta,
          transcript: session.transcript,
          children: this.manager.listChildren(session),
        });
        return;
      }
      if (req.method === 'DELETE') {
        const removed = await this.manager.deleteSession(sessionId);
        if (!removed) {
          sendJson(res, 404, { error: 'session not found' });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    if (!session) {
      sendJson(res, 404, { error: 'session not found' });
      return;
    }

    if (rest === '/messages' && req.method === 'POST') {
      const body = await readJson(req);
      const content = typeof body.content === 'string' ? body.content : '';
      if (content.trim() === '') {
        sendJson(res, 400, { error: 'content required' });
        return;
      }
      void session
        .runTurn({ content, ...(typeof body.name === 'string' ? { name: body.name } : {}) })
        .catch((error) => {
          this.manager.events.emit({
            type: 'error',
            sessionId,
            message: (error as Error).message,
          });
        });
      sendJson(res, 202, { accepted: true, sessionId });
      return;
    }

    if (rest === '/interrupt' && req.method === 'POST') {
      await session.interrupt();
      sendJson(res, 202, { accepted: true });
      return;
    }

    if (rest === '/continue' && req.method === 'POST') {
      session.meta.autoContinue = true;
      if (session.meta.goal?.status === 'paused') {
        session.meta.goal.status = 'active';
        session.meta.goal.updatedAt = new Date().toISOString();
        this.manager.events.emit({
          type: 'goal_updated',
          sessionId,
          goal: session.meta.goal,
        });
      }
      session.touch();
      void session
        .runTurn({
          content:
            'Continue your work. Inspect the current workspace state, do the next increment, and report progress.',
          name: 'system',
          goalRound: true,
        })
        .catch(() => undefined);
      sendJson(res, 202, { accepted: true });
      return;
    }

    if (rest === '/kernel' && req.method === 'POST') {
      const body = await readJson(req);
      const code = typeof body.code === 'string' ? body.code : '';
      const result = await session.execConsole(code);
      sendJson(res, 200, result);
      return;
    }

    if (rest === '/goal' && req.method === 'POST') {
      const body = await readJson(req);
      const objective = String(body.objective ?? '').trim();
      if (objective === '') {
        sendJson(res, 400, { error: 'objective required' });
        return;
      }
      session.meta.goal = {
        objective,
        status: 'active',
        rounds: 0,
        maxRounds: this.config.maxAutoRounds,
        sovereign: false,
        updatedAt: new Date().toISOString(),
      };
      session.meta.autoContinue = true;
      session.touch();
      this.manager.events.emit({
        type: 'goal_updated',
        sessionId,
        goal: session.meta.goal,
      });
      sendJson(res, 201, { goal: session.meta.goal });
      return;
    }

    if (rest === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      for (const event of this.manager.events.replay(sessionId)) {
        res.write(ssePayload(event));
      }
      const unsubscribe = this.manager.events.on((event) => {
        if (event.sessionId === sessionId) res.write(ssePayload(event));
      });
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      return;
    }

    sendJson(res, 404, { error: `no route for ${req.method} ${pathname}` });
  }
}
