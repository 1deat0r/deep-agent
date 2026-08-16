import { useEffect, useRef, useState } from 'react';
import type { SessionStatus, TranscriptEntry } from '../types';
import { CellBlock } from './CellBlock';
import { transcriptCellProps } from './cellProps';
import { MessageBubble } from './MessageBubble';

export interface ChatViewProps {
  transcript: TranscriptEntry[];
  draft: string;
  status: SessionStatus;
  onSend: (content: string) => void;
  onInterrupt: () => void;
  onContinue: () => void;
}

export function ChatView(props: ChatViewProps): JSX.Element {
  const { transcript, draft, status, onSend, onInterrupt, onContinue } = props;
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  const running = status === 'running';

  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [transcript, draft]);

  const submit = (): void => {
    const text = input.trim();
    if (text === '' || running) return;
    onSend(text);
    setInput('');
  };

  return (
    <div className="chat">
      {running && (
        <div className="running-banner">
          <span className="spinner" aria-hidden />
          <span className="running-banner__label">Agent is running…</span>
          <div className="running-banner__actions">
            <button type="button" className="btn btn--danger" onClick={onInterrupt}>
              Interrupt
            </button>
          </div>
        </div>
      )}

      <div className="chat__scroll" ref={scrollRef} onScroll={handleScroll}>
        {transcript.length === 0 && draft === '' && (
          <div className="chat__empty">Send a message to start.</div>
        )}

        {transcript.map((entry, index) => {
          if (entry.kind === 'cell') {
            return <CellBlock key={`cell-${index}`} {...transcriptCellProps(entry)} />;
          }
          return <MessageBubble key={`msg-${index}`} message={entry} />;
        })}

        {draft !== '' && (
          <div className="msg msg--assistant msg--streaming">
            <div className="msg__header">
              <span className="msg__author">assistant</span>
              <span className="msg__streaming-indicator" aria-hidden>
                ●
              </span>
            </div>
            <div className="msg__content">{draft}</div>
            <span className="msg__cursor" aria-hidden />
          </div>
        )}
      </div>

      <div className="chat__composer">
        <textarea
          className="chat__input"
          value={input}
          placeholder={running ? 'Agent is running — interrupt to type…' : 'Send a message… (Enter to send, Shift+Enter for a newline)'}
          rows={2}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat__composer-actions">
          <button type="button" className="btn btn--ghost" onClick={onContinue} title="Schedule an autonomous continuation turn">
            Continue
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={running || input.trim() === ''}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
