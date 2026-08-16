import type { SessionStatus } from '../types';

const LABELS: Record<SessionStatus, string> = {
  idle: 'idle',
  running: 'running',
  completed: 'completed',
};

export function StatusDot({ status }: { status: SessionStatus }): JSX.Element {
  return (
    <span
      className={`status-dot status-dot--${status}`}
      title={LABELS[status]}
      aria-label={LABELS[status]}
    />
  );
}
