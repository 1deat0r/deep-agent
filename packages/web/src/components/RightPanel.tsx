import { useState } from 'react';
import type { AppConfig, ChildSummary, SessionMeta } from '../types';
import { relativeTime, truncate } from '../format';
import { StatusDot } from './StatusDot';

export interface RightPanelProps {
  meta: SessionMeta;
  children: ChildSummary[];
  config: AppConfig | null;
  onSetGoal: (objective: string) => Promise<void>;
  onSelectChild: (id: string) => void;
  onDelete: () => void;
}

export function RightPanel(props: RightPanelProps): JSX.Element {
  const { meta, children, config, onSetGoal, onSelectChild, onDelete } = props;
  const [goalInput, setGoalInput] = useState('');
  const [goalOpen, setGoalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const workspace = config ? `${config.dataDir}/sessions/${meta.id}/workspace` : null;

  const submitGoal = async (): Promise<void> => {
    const objective = goalInput.trim();
    if (objective === '' || busy) return;
    setBusy(true);
    try {
      await onSetGoal(objective);
      setGoalInput('');
      setGoalOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="right-panel">
      <section className="panel-section">
        <h2 className="panel-section__title">Session</h2>
        <dl className="info-list">
          <div className="info-row">
            <dt>model</dt>
            <dd>{meta.model}</dd>
          </div>
          <div className="info-row">
            <dt>role</dt>
            <dd>{meta.role}</dd>
          </div>
          <div className="info-row">
            <dt>depth</dt>
            <dd>{meta.depth}</dd>
          </div>
          <div className="info-row">
            <dt>status</dt>
            <dd className="info-row__status">
              <StatusDot status={meta.status} /> {meta.status}
            </dd>
          </div>
          <div className="info-row">
            <dt>updated</dt>
            <dd>{relativeTime(meta.updatedAt)}</dd>
          </div>
          {workspace !== null && (
            <div className="info-row info-row--stack">
              <dt>workspace</dt>
              <dd className="info-row__path">{workspace}</dd>
            </div>
          )}
          {meta.parentTitle !== undefined && meta.parentTitle !== null && (
            <div className="info-row">
              <dt>parent</dt>
              <dd>{truncate(meta.parentTitle, 32)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="panel-section">
        <div className="panel-section__heading">
          <h2 className="panel-section__title">Goal</h2>
          {meta.goal === null && (
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setGoalOpen((o) => !o)}>
              + New
            </button>
          )}
        </div>

        {meta.goal === null ? (
          <div className="goal-card goal-card--empty">
            {goalOpen ? (
              <>
                <textarea
                  className="input goal-card__input"
                  placeholder="Describe the objective…"
                  value={goalInput}
                  rows={3}
                  onChange={(e) => setGoalInput(e.target.value)}
                  autoFocus
                />
                <div className="goal-card__actions">
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => setGoalOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    onClick={() => void submitGoal()}
                    disabled={busy || goalInput.trim() === ''}
                  >
                    Create goal
                  </button>
                </div>
              </>
            ) : (
              <p className="goal-card__none">No goal set. Create one to enable autonomous continuation.</p>
            )}
          </div>
        ) : (
          <div className="goal-card">
            <div className="goal-card__objective">{meta.goal.objective}</div>
            <div className="goal-card__meta">
              <span className={`goal-card__status goal-card__status--${meta.goal.status}`}>{meta.goal.status}</span>
              <span className="goal-card__rounds">
                round {meta.goal.rounds}/{meta.goal.maxRounds}
              </span>
            </div>
            {meta.goal.blockedReason !== undefined && meta.goal.blockedReason !== '' && (
              <div className="goal-card__blocked">{meta.goal.blockedReason}</div>
            )}
            {meta.goal.summary !== undefined && meta.goal.summary !== '' && (
              <div className="goal-card__summary">{meta.goal.summary}</div>
            )}
            <div className="goal-card__auto">
              auto-continue: <strong>{meta.autoContinue ? 'on' : 'off'}</strong>
            </div>
          </div>
        )}
      </section>

      <section className="panel-section panel-section--grow">
        <h2 className="panel-section__title">Children ({children.length})</h2>
        {children.length === 0 ? (
          <p className="panel-section__empty">No child agents yet.</p>
        ) : (
          <ul className="children-list">
            {children.map((child) => (
              <li key={child.id}>
                <button type="button" className="child-item" onClick={() => onSelectChild(child.id)}>
                  <span className="child-item__dot">
                    <StatusDot status={child.status} />
                  </span>
                  <span className="child-item__name">{truncate(child.name, 30)}</span>
                  <span className="child-item__depth">d{child.depth}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section panel-section--footer">
        <button type="button" className="btn btn--danger btn--small" onClick={onDelete}>
          Delete session
        </button>
      </section>
    </aside>
  );
}
