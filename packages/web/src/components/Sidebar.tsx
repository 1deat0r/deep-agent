import { useState } from 'react';
import type { SessionMeta } from '../types';
import { relativeTime, truncate } from '../format';
import { StatusDot } from './StatusDot';

export interface SidebarProps {
  sessions: SessionMeta[];
  selectedId: string | null;
  refreshing: boolean;
  onSelect: (id: string) => void;
  onCreate: (input: { title?: string; goal?: string; model?: string }) => Promise<void>;
  onRefresh: () => void;
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const { sessions, selectedId, refreshing, onSelect, onCreate, onRefresh } = props;
  const [creating, setCreating] = useState(false);

  // The server's manager.list() is not sorted by recency; enforce it here.
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const submit = async (): Promise<void> => {
    setCreating(true);
    try {
      await onCreate({});
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden>
          ◈
        </span>
        <span className="sidebar__brand-name">deep-agent</span>
      </div>

      <div className="sidebar__actions">
        <button
          type="button"
          className="btn btn--primary sidebar__new"
          onClick={() => void submit()}
          disabled={creating}
          title="Create a new session"
        >
          + New session
        </button>
        <button
          type="button"
          className={`btn btn--ghost sidebar__refresh${refreshing ? ' is-refreshing' : ''}`}
          onClick={onRefresh}
          title="Refresh sessions"
          aria-label="Refresh sessions"
        >
          ⟳
        </button>
      </div>

      <nav className="sidebar__list">
        {sorted.length === 0 && <div className="sidebar__empty">No sessions yet</div>}
        {sorted.map((session) => {
          const active = session.id === selectedId;
          return (
            <button
              type="button"
              key={session.id}
              className={`session-item${active ? ' session-item--active' : ''}`}
              onClick={() => onSelect(session.id)}
            >
              <span className="session-item__dot">
                <StatusDot status={session.status} />
              </span>
              <span className="session-item__body">
                <span className="session-item__title">{truncate(session.title, 40)}</span>
                <span className="session-item__sub">
                  {session.role === 'child' ? `child · depth ${session.depth}` : relativeTime(session.updatedAt)}
                </span>
              </span>
              {session.goal !== null && (
                <span className={`session-item__badge session-item__badge--${session.goal.status}`} title={session.goal.objective}>
                  {session.goal.status === 'active' ? '◉' : '○'}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
