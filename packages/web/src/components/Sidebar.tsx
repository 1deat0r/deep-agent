import { useState } from 'react';
import type { SessionMeta } from '../types';
import { relativeTime, truncate } from '../format';
import { StatusDot } from './StatusDot';

export interface SidebarProps {
  sessions: SessionMeta[];
  selectedId: string | null;
  refreshing: boolean;
  models: string[];
  defaultModel: string;
  onSelect: (id: string) => void;
  onCreate: (input: { title?: string; goal?: string; model?: string }) => Promise<void>;
  onRefresh: () => void;
}

export function Sidebar(props: SidebarProps): JSX.Element {
  const { sessions, selectedId, refreshing, models, defaultModel, onSelect, onCreate, onRefresh } =
    props;
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [submitting, setSubmitting] = useState(false);

  // The server's manager.list() is not sorted by recency; enforce it here.
  const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const submit = async (): Promise<void> => {
    const trimmedTitle = title.trim();
    const trimmedGoal = goal.trim();
    setSubmitting(true);
    try {
      await onCreate({
        ...(trimmedTitle !== '' ? { title: trimmedTitle } : {}),
        ...(trimmedGoal !== '' ? { goal: trimmedGoal } : {}),
        ...(model.trim() !== '' ? { model: model.trim() } : {}),
      });
      setFormOpen(false);
      setTitle('');
      setGoal('');
    } finally {
      setSubmitting(false);
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
        <button type="button" className="btn btn--primary sidebar__new" onClick={() => setFormOpen((o) => !o)}>
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

      {formOpen && (
        <div className="sidebar__form">
          <input
            className="input"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            autoFocus
          />
          <textarea
            className="input sidebar__form-goal"
            placeholder="Goal (optional) — enables auto-continuation"
            value={goal}
            rows={2}
            onChange={(e) => setGoal(e.target.value)}
          />
          {models.length > 0 && (
            <select
              className="input sidebar__form-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              title="Model for this session"
            >
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <div className="sidebar__form-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void submit()} disabled={submitting}>
              Create
            </button>
          </div>
        </div>
      )}

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
