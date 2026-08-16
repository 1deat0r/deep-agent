import { useState } from 'react';
import { formatDuration, formatTime } from '../format';

export interface CellBlockProps {
  code: string;
  stdout: string;
  stderr: string;
  resultRepr: string | null;
  errorMessage: string | null;
  errorTraceback: string[];
  durationMs: number;
  timestamp?: string;
}

/**
 * Renders a kernel console cell: code block, stdout/stderr, result repr, and
 * error (in red) with its duration. Shared by the chat transcript and the
 * console tab (which feeds it a raw ExecResult).
 */
export function CellBlock(props: CellBlockProps): JSX.Element {
  const { code, stdout, stderr, resultRepr, errorMessage, errorTraceback, durationMs } = props;
  const [collapsed, setCollapsed] = useState(false);

  const hasOutput = stdout !== '' || stderr !== '' || resultRepr !== null || errorMessage !== null;
  const isError = errorMessage !== null;

  return (
    <div className={`cell-block${isError ? ' cell-block--error' : ''}`}>
      <div className="cell-block__bar">
        <button
          type="button"
          className="cell-block__toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand cell' : 'Collapse cell'}
        >
          <span className="cell-block__chevron">{collapsed ? '▸' : '▾'}</span>
          <span className="cell-block__label">{isError ? 'cell (error)' : 'cell'}</span>
        </button>
        <span className="cell-block__meta">
          {props.timestamp !== undefined && (
            <span className="cell-block__time">{formatTime(props.timestamp)}</span>
          )}
          <span className="cell-block__duration">{formatDuration(durationMs)}</span>
        </span>
      </div>

      {!collapsed && (
        <div className="cell-block__body">
          <pre className="cell-block__code">{code}</pre>
          {stdout !== '' && (
            <div className="cell-block__section">
              <div className="cell-block__section-label">stdout</div>
              <pre className="cell-block__out">{stdout}</pre>
            </div>
          )}
          {stderr !== '' && (
            <div className="cell-block__section">
              <div className="cell-block__section-label">stderr</div>
              <pre className="cell-block__out cell-block__out--stderr">{stderr}</pre>
            </div>
          )}
          {resultRepr !== null && resultRepr !== '' && (
            <div className="cell-block__section">
              <div className="cell-block__section-label">result</div>
              <pre className="cell-block__out">{resultRepr}</pre>
            </div>
          )}
          {errorMessage !== null && (
            <div className="cell-block__section">
              <div className="cell-block__section-label">error</div>
              <pre className="cell-block__out cell-block__out--error">
                {errorMessage}
                {errorTraceback.length > 0 ? `\n${errorTraceback.join('\n')}` : ''}
              </pre>
            </div>
          )}
          {!hasOutput && <div className="cell-block__empty">(no output)</div>}
        </div>
      )}
    </div>
  );
}
