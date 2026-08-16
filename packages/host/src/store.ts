import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from '@deep-agent/provider';
import type { SessionMeta, TranscriptEntry } from './types.js';

/**
 * On-disk persistence: one directory per session holding meta.json,
 * transcript.jsonl (messages + cells), and the session workspace.
 */
export class SessionStore {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  dirFor(id: string): string {
    return join(this.root, id);
  }

  workspaceFor(id: string): string {
    return join(this.dirFor(id), 'workspace');
  }

  saveMeta(meta: SessionMeta): void {
    const dir = this.dirFor(meta.id);
    mkdirSync(dir, { recursive: true });
    mkdirSync(this.workspaceFor(meta.id), { recursive: true });
    writeFileSync(join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  }

  loadMeta(id: string): SessionMeta | null {
    const path = join(this.dirFor(id), 'meta.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as SessionMeta;
    } catch {
      return null;
    }
  }

  appendTranscript(id: string, entry: TranscriptEntry): void {
    appendFileSync(join(this.dirFor(id), 'transcript.jsonl'), `${JSON.stringify(entry)}\n`);
  }

  loadTranscript(id: string): TranscriptEntry[] {
    const path = join(this.dirFor(id), 'transcript.jsonl');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as TranscriptEntry);
  }

  listSessions(): SessionMeta[] {
    const metas: SessionMeta[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const meta = this.loadMeta(entry.name);
      if (meta) metas.push(meta);
    }
    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return metas;
  }

  /** Remove a session directory from disk. Idempotent. */
  removeSession(id: string): void {
    const dir = this.dirFor(id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  /** Extract the LLM-facing message list from transcript entries. */
  static messagesFrom(transcript: TranscriptEntry[]): ChatMessage[] {
    return transcript
      .filter((entry): entry is TranscriptEntry & { kind: 'message' } => entry.kind === 'message')
      .map(({ kind: _kind, ...message }) => message);
  }
}
