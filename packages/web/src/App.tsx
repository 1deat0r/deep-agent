import { useCallback, useEffect, useRef, useState } from 'react';
import {
  continueSession,
  createSession,
  getModels,
  deleteSession,
  eventsUrl,
  getConfig,
  getSession,
  getSessions,
  interruptSession,
  runKernel,
  sendMessage,
  setGoal,
} from './api';
import type {
  AppConfig,
  ChildSummary,
  HostEvent,
  SessionDetail,
  SessionMeta,
  SessionStatus,
  TranscriptEntry,
  TranscriptMessage,
} from './types';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ConsoleView } from './components/ConsoleView';
import { RightPanel } from './components/RightPanel';
import { SettingsModal } from './components/SettingsModal';
import {
  desktopSettingsAvailable,
  getDesktopSettingsState,
} from './desktop-settings';
import { StatusDot } from './components/StatusDot';
import { Toasts, type Toast, type ToastKind } from './components/Toasts';

// ---------------------------------------------------------------------------
// Pure transcript/detail reconciliation helpers
// ---------------------------------------------------------------------------

function entryEq(a: TranscriptEntry, b: TranscriptEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'cell') {
    const cellB = b as Extract<TranscriptEntry, { kind: 'cell' }>;
    return a.timestamp === cellB.timestamp && a.code === cellB.code;
  }
  const msgA = a as TranscriptMessage;
  const msgB = b as TranscriptMessage;
  return (
    msgA.role === msgB.role &&
    msgA.content === msgB.content &&
    JSON.stringify(msgA.tool_calls ?? null) === JSON.stringify(msgB.tool_calls ?? null)
  );
}

function reconcileTranscript(local: TranscriptEntry[], snap: TranscriptEntry[]): TranscriptEntry[] {
  let i = 0;
  while (i < local.length && i < snap.length && entryEq(local[i] as TranscriptEntry, snap[i] as TranscriptEntry)) {
    i += 1;
  }
  // If the snapshot is a prefix of the local transcript, the local view is
  // ahead (live events arrived after the snapshot was taken) — keep it.
  if (i === snap.length) return local;
  // Otherwise trust the authoritative snapshot (it may be ahead, or the two
  // diverged after a missed event).
  return snap;
}

function mergeChildren(local: ChildSummary[], snap: ChildSummary[]): ChildSummary[] {
  const byId = new Map<string, ChildSummary>();
  for (const child of snap) byId.set(child.id, child);
  for (const child of local) {
    if (!byId.has(child.id)) byId.set(child.id, child);
  }
  return [...byId.values()];
}

function reconcileDetail(local: SessionDetail | null, snap: SessionDetail): SessionDetail {
  if (local === null) return snap;
  return {
    meta: snap.meta,
    transcript: reconcileTranscript(local.transcript, snap.transcript),
    children: mergeChildren(local.children, snap.children),
  };
}

function applyMessage(detail: SessionDetail, message: TranscriptMessage): SessionDetail {
  const last = detail.transcript[detail.transcript.length - 1];
  if (last !== undefined && entryEq(last, message)) return detail;
  return { ...detail, transcript: [...detail.transcript, message] };
}

function applyCell(detail: SessionDetail, cell: Extract<TranscriptEntry, { kind: 'cell' }>): SessionDetail {
  const dup = detail.transcript.some(
    (e) => e.kind === 'cell' && e.timestamp === cell.timestamp && e.code === cell.code,
  );
  if (dup) return detail;
  return { ...detail, transcript: [...detail.transcript, cell] };
}

function applyChildSpawned(detail: SessionDetail, child: ChildSummary): SessionDetail {
  if (detail.children.some((c) => c.id === child.id)) return detail;
  return { ...detail, children: [...detail.children, child] };
}

function applyChildFinished(detail: SessionDetail, childId: string): SessionDetail {
  return {
    ...detail,
    children: detail.children.map((c) => (c.id === childId ? { ...c, status: 'idle' as SessionStatus } : c)),
  };
}

// ---------------------------------------------------------------------------
// Typed SSE event listener
// ---------------------------------------------------------------------------

type EventMap = { [K in HostEvent['type']]: Extract<HostEvent, { type: K }> };

function addEvent<K extends HostEvent['type']>(
  es: EventSource,
  type: K,
  handler: (data: EventMap[K]) => void,
): void {
  es.addEventListener(type, (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as EventMap[K];
      handler(data);
    } catch {
      // ignore malformed event payloads
    }
  });
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

type Tab = 'chat' | 'console';

export function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [draft, setDraft] = useState('');
  const streamedRef = useRef(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('chat');
  const [refreshing, setRefreshing] = useState(false);

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const patchSessions = useCallback((id: string, patch: Partial<SessionMeta>) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const loadSessions = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const res = await getSessions();
      setSessions(res.sessions);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [pushToast]);

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      setConfig(await getConfig());
      const modelsInfo = await getModels();
      setModels(modelsInfo.models);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [pushToast]);

  useEffect(() => {
    void loadConfig();
    void loadSessions();
  }, [loadConfig, loadSessions]);

  // Desktop shell: first run with no config / no API key opens Settings so the
  // user lands in the provider form before anything else (ticket 04).
  useEffect(() => {
    if (!desktopSettingsAvailable()) return;
    let cancelled = false;
    getDesktopSettingsState()
      .then((state) => {
        if (!cancelled && state !== null && state.isFirstRun) setSettingsOpen(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Session selection: fetch snapshot, then open the SSE stream.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDraft('');
      streamedRef.current = false;
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let connectedOnce = false;

    setDetail(null);
    setDraft('');
    streamedRef.current = false;

    const reconcile = async (): Promise<void> => {
      try {
        const snap = await getSession(selectedId);
        if (!cancelled) setDetail((prev) => reconcileDetail(prev, snap));
      } catch (err) {
        if (!cancelled) pushToast('error', err instanceof Error ? err.message : String(err));
      }
    };

    const openEvents = (): void => {
      es = new EventSource(eventsUrl(selectedId));
      es.onopen = () => {
        if (connectedOnce) {
          // Reconnect: replay + live are re-established; reconcile once.
          setDraft('');
          streamedRef.current = false;
          void reconcile();
        }
        connectedOnce = true;
      };

      addEvent(es, 'status', (data) => {
        setDetail((prev) => (prev ? { ...prev, meta: { ...prev.meta, status: data.status } } : prev));
        patchSessions(data.sessionId, { status: data.status });
      });

      addEvent(es, 'turn_start', () => {
        setDraft('');
        streamedRef.current = false;
      });

      addEvent(es, 'message_delta', (data) => {
        setDraft((prev) => prev + data.delta);
        streamedRef.current = true;
      });

      addEvent(es, 'message_complete', (data) => {
        const message: TranscriptMessage = { kind: 'message', ...data.message };
        if (streamedRef.current) {
          setDetail((prev) => (prev ? applyMessage(prev, message) : prev));
          setDraft('');
          streamedRef.current = false;
        } else {
          // Completed without streamed deltas (tool-call-only response, or a
          // page reload mid-turn): pull the authoritative transcript.
          setDraft('');
          void reconcile();
        }
      });

      addEvent(es, 'cell_result', (data) => {
        setDetail((prev) => (prev ? applyCell(prev, data.cell) : prev));
      });

      addEvent(es, 'child_spawned', (data) => {
        setDetail((prev) => (prev ? applyChildSpawned(prev, data.child) : prev));
      });

      addEvent(es, 'child_finished', (data) => {
        setDetail((prev) => (prev ? applyChildFinished(prev, data.childId) : prev));
      });

      addEvent(es, 'goal_updated', (data) => {
        setDetail((prev) =>
          prev ? { ...prev, meta: { ...prev.meta, goal: data.goal, autoContinue: true } } : prev,
        );
        patchSessions(data.sessionId, { goal: data.goal, autoContinue: true });
      });

      addEvent(es, 'turn_end', () => {
        setDraft('');
        streamedRef.current = false;
        void reconcile();
      });

      addEvent(es, 'session_deleted', (data) => {
        // Remove from the sidebar list regardless of which session it was.
        setSessions((prev) => prev.filter((s) => s.id !== data.sessionId));
        if (data.sessionId === selectedId) {
          setSelectedId(null);
          setDetail(null);
          setDraft('');
          streamedRef.current = false;
        } else {
          // A child of this session was deleted; drop it from the children list.
          setDetail((prev) =>
            prev ? { ...prev, children: prev.children.filter((c) => c.id !== data.sessionId) } : prev,
          );
        }
      });

      addEvent(es, 'error', (data) => {
        pushToast('error', data.message);
      });
    };

    void (async () => {
      await reconcile();
      if (cancelled) return;
      openEvents();
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [selectedId, pushToast, patchSessions]);

  // -- actions -------------------------------------------------------------

  const handleCreate = useCallback(
    async (input: { title?: string; goal?: string; model?: string }): Promise<void> => {
      try {
        const { meta } = await createSession(input);
        setSessions((prev) => [meta, ...prev]);
        setSelectedId(meta.id);
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      }
    },
    [pushToast],
  );

  const handleSend = useCallback(
    async (content: string): Promise<void> => {
      if (selectedId === null) return;
      const userMessage: TranscriptMessage = { kind: 'message', role: 'user', content };
      setDetail((prev) => (prev ? applyMessage(prev, userMessage) : prev));
      try {
        await sendMessage(selectedId, content);
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err));
      }
    },
    [selectedId, pushToast],
  );

  const handleInterrupt = useCallback(async (): Promise<void> => {
    if (selectedId === null) return;
    try {
      await interruptSession(selectedId);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [selectedId, pushToast]);

  const handleContinue = useCallback(async (): Promise<void> => {
    if (selectedId === null) return;
    try {
      await continueSession(selectedId);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [selectedId, pushToast]);

  const handleRun = useCallback(
    async (code: string) => {
      if (selectedId === null) throw new Error('no session selected');
      return runKernel(selectedId, code);
    },
    [selectedId],
  );

  const handleSetGoal = useCallback(
    async (objective: string): Promise<void> => {
      if (selectedId === null) return;
      const { goal } = await setGoal(selectedId, objective);
      setDetail((prev) => (prev ? { ...prev, meta: { ...prev.meta, goal, autoContinue: true } } : prev));
      patchSessions(selectedId, { goal, autoContinue: true });
    },
    [selectedId, patchSessions],
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    if (selectedId === null) return;
    if (!window.confirm('Delete this session and its workspace?')) return;
    try {
      await deleteSession(selectedId);
      setSelectedId(null);
    } catch (err) {
      // DELETE returns 404 for unknown sessions; resync either way.
      pushToast('error', err instanceof Error ? err.message : String(err));
    } finally {
      await loadSessions();
    }
  }, [selectedId, loadSessions, pushToast]);

  const handleSelectChild = useCallback((id: string) => setSelectedId(id), []);

  // -- render --------------------------------------------------------------

  const status = detail?.meta.status ?? 'idle';

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        selectedId={selectedId}
        refreshing={refreshing}
        onSelect={setSelectedId}
        models={models}
        defaultModel={config?.provider.model ?? ''}
        onCreate={handleCreate}
        onRefresh={() => void loadSessions()}
      />

      <main className="main">
        <header className="main__header">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'chat'}
              className={`tab${tab === 'chat' ? ' tab--active' : ''}`}
              onClick={() => setTab('chat')}
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'console'}
              className={`tab${tab === 'console' ? ' tab--active' : ''}`}
              onClick={() => setTab('console')}
            >
              Console
            </button>
          </div>

          {detail !== null && (
            <div className="main__title">
              <StatusDot status={status} />
              <span className="main__title-text" title={detail.meta.title}>
                {detail.meta.title}
              </span>
            </div>
          )}

          <div className="main__actions">
            <button
              type="button"
              className={`btn btn--ghost${rightOpen ? ' is-active' : ''}`}
              onClick={() => setRightOpen((o) => !o)}
              title="Toggle details panel"
            >
              ⓘ
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setSettingsOpen(true)} title="Settings">
              ⚙
            </button>
          </div>
        </header>

        <div className="main__content">
          {selectedId === null ? (
            <div className="empty-state">
              <div className="empty-state__mark" aria-hidden>
                ◈
              </div>
              <p>{sessions.length === 0 ? 'No sessions yet — create one to start.' : 'Select a session to begin.'}</p>
            </div>
          ) : detail === null ? (
            <div className="empty-state">
              <div className="spinner" aria-hidden />
              <p>Loading session…</p>
            </div>
          ) : tab === 'chat' ? (
            <ChatView
              transcript={detail.transcript}
              draft={draft}
              status={status}
              onSend={(c) => void handleSend(c)}
              onInterrupt={() => void handleInterrupt()}
              onContinue={() => void handleContinue()}
            />
          ) : (
            <ConsoleView transcript={detail.transcript} onRun={handleRun} />
          )}
        </div>
      </main>

      {rightOpen && detail !== null && (
        <RightPanel
          meta={detail.meta}
          children={detail.children}
          config={config}
          onSetGoal={handleSetGoal}
          onSelectChild={handleSelectChild}
          onDelete={() => void handleDelete()}
        />
      )}

      {settingsOpen && <SettingsModal config={config} onClose={() => setSettingsOpen(false)} />}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
