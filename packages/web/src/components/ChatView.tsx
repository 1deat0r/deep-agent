import { useEffect, useRef, useState } from 'react';
import type { SessionMeta, SessionStatus, TranscriptEntry } from '../types';
import { formatTokens, usageStats } from '../usage';
import { truncate } from '../format';
import { CellBlock } from './CellBlock';
import { transcriptCellProps } from './cellProps';
import { MessageBubble } from './MessageBubble';

export interface ChatViewProps {
  transcript: TranscriptEntry[];
  draft: string;
  status: SessionStatus;
  meta: SessionMeta;
  models: string[];
  onSend: (content: string) => void;
  onInterrupt: () => void;
  onContinue: () => void;
  onUpdateSettings: (settings: { model?: string; reasoningEffort?: string }) => void;
}

export function ChatView(props: ChatViewProps): JSX.Element {
  const { transcript, draft, status, meta, models, onSend, onInterrupt, onContinue, onUpdateSettings } =
    props;
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
          if (entry.kind === 'compaction') {
            return (
              <div key={`compaction-${index}`} className="msg msg--system">
                <div className="msg__header">
                  <span className="msg__author">system</span>
                </div>
                <div className="msg__content">Context compacted — {truncate(entry.summary, 160)}</div>
              </div>
            );
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
        <ComposerMeta
          meta={meta}
          models={models}
          transcript={transcript}
          onUpdateSettings={onUpdateSettings}
        />
      </div>
    </div>
  );
}

interface ComposerMetaProps {
  meta: SessionMeta;
  models: string[];
  transcript: TranscriptEntry[];
  onUpdateSettings: (settings: { model?: string; reasoningEffort?: string }) => void;
}

function ComposerMeta(props: ComposerMetaProps): JSX.Element {
  const { meta, models, transcript, onUpdateSettings } = props;
  const stats = usageStats(transcript);
  const modelOptions = models.includes(meta.model) ? models : [meta.model, ...models];
  const cacheRate = stats.lastTurn.cacheRate;
  const showUsage = stats.session.input + stats.session.output > 0;

  return (
    <div className="chat__composer-meta">
      <select
        className="input chat__composer-select"
        value={meta.model}
        onChange={(e) => onUpdateSettings({ model: e.target.value })}
        title="Model for this session"
        aria-label="Model"
      >
        {modelOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        className="input chat__composer-select"
        value={meta.reasoningEffort ?? 'auto'}
        onChange={(e) => onUpdateSettings({ reasoningEffort: e.target.value })}
        title="Reasoning effort (auto = provider default)"
        aria-label="Reasoning effort"
      >
        <option value="auto">auto</option>
        <option value="low">low</option>
        <option value="high">high</option>
        <option value="max">max</option>
      </select>
      {showUsage && (
        <span
          className="chat__usage"
          title={`last turn: up ${stats.lastTurn.input} / down ${stats.lastTurn.output} tokens — session: up ${stats.session.input} / down ${stats.session.output} tokens`}
        >
          <span aria-hidden>↑</span>
          {formatTokens(stats.lastTurn.input)} <span aria-hidden>↓</span>
          {formatTokens(stats.lastTurn.output)}
          {cacheRate !== null && stats.lastTurn.cacheHit + stats.lastTurn.cacheMiss > 0
            ? ` · cache ${Math.round(cacheRate * 100)}%`
            : ''}
          <span className="chat__usage-session">
            {' '}
            · session <span aria-hidden>↑</span>
            {formatTokens(stats.session.input)} <span aria-hidden>↓</span>
            {formatTokens(stats.session.output)}
          </span>
        </span>
      )}
    </div>
  );
}
