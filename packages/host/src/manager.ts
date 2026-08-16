import type { LlmClient } from '@deep-agent/provider';
import { EventBus } from './events.js';
import { AgentSession, type SessionDeps, type SessionHost } from './session.js';
import { SkillsRegistry } from './skills.js';
import { SessionStore } from './store.js';
import type { ChildSummary, HostConfig, SessionMeta } from './types.js';

/**
 * Owns every session in the process: creation, resume, child spawning with
 * depth limits, message routing between parents and children, and disposal.
 */
export class AgentManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly childMeta = new Map<string, { parentId: string; name: string }>();
  private readonly hostBridge: SessionHost;

  constructor(
    readonly store: SessionStore,
    readonly events: EventBus,
    readonly config: HostConfig,
    readonly skills: SkillsRegistry,
    readonly createClient: SessionDeps['createClient'],
  ) {
    this.hostBridge = {
      spawnChild: (parent, prompt, name) => this.spawnChild(parent, prompt, name),
      listChildren: (parent) => this.listChildren(parent),
      deleteChild: (parent, nameOrId) => this.deleteChild(parent, nameOrId),
      routeMessage: (from, payload) => this.routeMessage(from, payload),
    };
  }

  depsFor(): Parameters<typeof AgentSession.create>[0] {
    return {
      store: this.store,
      events: this.events,
      config: this.config,
      skills: this.skills,
      createClient: this.createClient,
      host: this.hostBridge,
    };
  }

  async createSession(options: {
    title: string | undefined;
    goal: string | null | undefined;
    autoContinue: boolean | undefined;
    model: string | undefined;
  }): Promise<AgentSession> {
    const session = await AgentSession.create(this.depsFor(), {
      title: options.title,
      goal: options.goal,
      autoContinue: options.autoContinue ?? (options.goal ? true : false),
      role: 'root',
      parentId: null,
      depth: 0,
      model: options.model,
    });
    this.sessions.set(session.id, session);
    return session;
  }

  /** Resume persisted sessions (restarted host). */
  loadAll(): AgentSession[] {
    const metas = this.store.listSessions();
    const loaded: AgentSession[] = [];
    for (const meta of metas) {
      const session = AgentSession.load(this.depsFor(), meta.id);
      if (!session) continue;
      session.meta.status = 'idle';
      session.touch();
      this.sessions.set(session.id, session);
      loaded.push(session);
    }
    for (const meta of metas) {
      if (meta.parentId) {
        const parent = this.sessions.get(meta.parentId);
        const name = meta.title || meta.id;
        this.childMeta.set(meta.id, { parentId: meta.parentId, name });
        const session = this.sessions.get(meta.id);
        if (session) {
          session.meta.parentTitle = parent?.meta.title ?? null;
          session.touch();
        }
      }
    }
    return loaded;
  }

  get(id: string): AgentSession | undefined {
    return this.sessions.get(id);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((session) => session.meta)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async spawnChild(
    parent: AgentSession,
    prompt: string,
    name?: string,
  ): Promise<{ child_id: string; name: string; session_dir: string; model: string }> {
    if (parent.meta.depth >= this.config.maxDepth) {
      throw new Error(`max agent depth reached (${this.config.maxDepth})`);
    }
    const child = await AgentSession.create(this.depsFor(), {
      title: name ?? `child of ${parent.meta.title}`,
      role: 'child',
      parentId: parent.id,
      depth: parent.meta.depth + 1,
      goal: null,
      autoContinue: false,
      model: parent.meta.model,
    });
    child.meta.parentTitle = parent.meta.title;
    this.sessions.set(child.id, child);
    const childName = child.meta.title;
    this.childMeta.set(child.id, { parentId: parent.id, name: childName });

    parent.meta.childIds.push(child.id);
    parent.touch();
    const summary: ChildSummary = {
      id: child.id,
      name: childName,
      status: child.meta.status,
      depth: child.meta.depth,
      model: child.meta.model,
    };
    this.events.emit({ type: 'child_spawned', sessionId: parent.id, child: summary });

    // Run the child's first turn in the background; completion routes back to
    // the parent and (if enabled) wakes it with a continuation turn.
    void child
      .runTurn({ content: prompt })
      .then((result) => this.onChildFinished(parent, child, result))
      .catch((error) => {
        this.events.emit({
          type: 'error',
          sessionId: child.id,
          message: `child turn failed: ${(error as Error).message}`,
        });
      });

    return {
      child_id: child.id,
      name: childName,
      session_dir: child.sessionDir,
      model: child.meta.model,
    };
  }

  private onChildFinished(
    parent: AgentSession,
    child: AgentSession,
    result: { ok: boolean; summary: string; error?: string },
  ): void {
    const summary = result.ok
      ? result.summary || '(child finished)'
      : `child failed: ${result.error ?? 'unknown error'}`;
    this.events.emit({ type: 'child_finished', sessionId: parent.id, childId: child.id, summary });
    parent.append({
      kind: 'message',
      role: 'user',
      name: child.meta.title,
      content: `[child "${child.meta.title}" finished]\n${summary.slice(0, 4000)}`,
    });
    this.wakeParent(parent, `Child "${child.meta.title}" reported back. Review its result, integrate it into the workspace if useful, and continue the task.`);
  }

  listChildren(parent: AgentSession): ChildSummary[] {
    const children: ChildSummary[] = [];
    for (const childId of parent.meta.childIds) {
      const child = this.sessions.get(childId);
      const meta = this.childMeta.get(childId);
      children.push({
        id: childId,
        name: meta?.name ?? child?.meta.title ?? childId,
        status: child?.meta.status ?? 'idle',
        depth: child?.meta.depth ?? parent.meta.depth + 1,
        model: child?.meta.model ?? parent.meta.model,
      });
    }
    return children;
  }

  async deleteChild(parent: AgentSession, nameOrId: string): Promise<void> {
    const childId =
      parent.meta.childIds.find((id) => id === nameOrId) ??
      parent.meta.childIds.find((id) => (this.childMeta.get(id)?.name ?? id) === nameOrId);
    if (!childId) throw new Error(`no child named "${nameOrId}"`);
    // deleteSession handles disposal, parent bookkeeping, and disk removal.
    await this.deleteSession(childId);
  }

  async routeMessage(
    from: AgentSession,
    payload: { message: string; receiver_role: string; receiver_name?: string },
  ): Promise<void> {
    if (payload.receiver_role === 'parent') {
      if (!from.meta.parentId) throw new Error('this session has no parent');
      const parent = this.sessions.get(from.meta.parentId);
      if (!parent) throw new Error('parent session not found');
      parent.append({
        kind: 'message',
        role: 'user',
        name: from.meta.title,
        content: payload.message,
      });
      this.events.emit({
        type: 'child_finished',
        sessionId: parent.id,
        childId: from.id,
        summary: payload.message,
      });
      this.wakeParent(parent, `Child "${from.meta.title}" sent: ${payload.message}`);
      return;
    }
    if (payload.receiver_role === 'child') {
      const childId =
        from.meta.childIds.find((id) => (this.childMeta.get(id)?.name ?? id) === payload.receiver_name) ??
        from.meta.childIds.find((id) => id === payload.receiver_name);
      if (!childId) throw new Error(`no child named "${payload.receiver_name ?? ''}"`);
      const child = this.sessions.get(childId);
      if (!child) throw new Error('child session not found');
      await child.runTurn({ content: payload.message, name: from.meta.title });
      return;
    }
    throw new Error(`unknown receiver_role "${payload.receiver_role}"`);
  }

  async deleteSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    // Cascade: children (and their descendants) go first so no session is
    // left with a dangling parent.
    for (const childId of [...session.meta.childIds]) {
      await this.deleteSession(childId);
    }
    await session.dispose();
    this.sessions.delete(id);
    this.childMeta.delete(id);
    if (session.meta.parentId) {
      const parent = this.sessions.get(session.meta.parentId);
      if (parent) {
        parent.meta.childIds = parent.meta.childIds.filter((childId) => childId !== id);
        parent.touch();
      }
    }
    this.store.removeSession(id);
    this.events.emit({ type: 'session_deleted', sessionId: id });
    return true;
  }

  /**
   * A child reply always wakes the parent (children reply when an answer is
   * needed). When an active goal is running on auto-continue, the wake counts
   * as a goal round; otherwise it is a single bounded continuation turn.
   */
  private wakeParent(parent: AgentSession, prompt: string): void {
    const isGoalRound = parent.meta.goal?.status === 'active' && parent.meta.autoContinue;
    void parent
      .runTurn({
        content: prompt,
        name: 'system',
        ...(isGoalRound ? { goalRound: true } : {}),
      })
      .catch(() => undefined);
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((session) => session.dispose()));
    this.sessions.clear();
  }
}
