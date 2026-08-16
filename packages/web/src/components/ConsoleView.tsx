import { useRef, useState } from 'react';
import type { ExecResult, TranscriptEntry } from '../types';
import { CellBlock } from './CellBlock';
import { execResultProps, transcriptCellProps } from './cellProps';

interface ManualResult {
  code: string;
  result: ExecResult;
}

export interface ConsoleViewProps {
  transcript: TranscriptEntry[];
  onRun: (code: string) => Promise<ExecResult>;
}

export function ConsoleView(props: ConsoleViewProps): JSX.Element {
  const { transcript, onRun } = props;
  const [code, setCode] = useState('');
  const [results, setResults] = useState<ManualResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const cells = transcript.filter((entry): entry is TranscriptEntry & { kind: 'cell' } => {
    return entry.kind === 'cell';
  });

  const run = async (): Promise<void> => {
    const trimmed = code.trim();
    if (trimmed === '' || running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await onRun(trimmed);
      setResults((prev) => [...prev, { code: trimmed, result }]);
      setCode('');
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="console">
      <div className="console__scroll" ref={scrollRef}>
        {cells.length === 0 && results.length === 0 && (
          <div className="console__empty">No cells yet. Run code to open a REPL into this session's persistent kernel.</div>
        )}

        {cells.map((cell, index) => (
          <CellBlock key={`console-cell-${index}`} {...transcriptCellProps(cell)} />
        ))}

        {results.map((item, index) => (
          <CellBlock key={`console-result-${index}`} {...execResultProps(item.code, item.result)} />
        ))}
      </div>

      <div className="console__composer">
        {error !== null && <div className="console__error">{error}</div>}
        <textarea
          className="console__input"
          value={code}
          placeholder={'# Python code in the session kernel\n# e.g. print("hello")'}
          rows={4}
          spellCheck={false}
          disabled={running}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div className="console__actions">
          <span className="console__hint">Ctrl/Cmd+Enter to run</span>
          <button type="button" className="btn btn--primary" onClick={() => void run()} disabled={running || code.trim() === ''}>
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}
