import { useState } from 'react';
import type { TranscriptMessage } from '../types';
import { prettyJson, truncate } from '../format';

function ToolCallList({ calls }: { calls: NonNullable<TranscriptMessage['tool_calls']> }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-calls">
      <button type="button" className="tool-calls__toggle" onClick={() => setOpen((o) => !o)}>
        <span className="tool-calls__chevron">{open ? '▾' : '▸'}</span>
        <span>
          {calls.length} tool call{calls.length === 1 ? '' : 's'} →{' '}
          {calls.map((c) => c.function.name).join(', ')}
        </span>
      </button>
      {open && (
        <div className="tool-calls__list">
          {calls.map((call) => (
            <div className="tool-call" key={call.id}>
              <div className="tool-call__name">{call.function.name}</div>
              <pre className="tool-call__args">{prettyJson(call.function.arguments)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message }: { message: TranscriptMessage }): JSX.Element {
  const { role, content, name, tool_calls, tool_call_id } = message;

  if (role === 'tool') {
    return (
      <div className="msg msg--tool">
        <div className="msg__header">
          <span className="msg__author">tool</span>
          {tool_call_id !== undefined && <span className="msg__tool-id">· {truncate(tool_call_id, 20)}</span>}
        </div>
        {content !== null && content !== '' && (
          <pre className="msg__tool-content">{content}</pre>
        )}
      </div>
    );
  }

  const isSystem = role === 'system';
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';

  return (
    <div className={`msg msg--${role}`}>
      <div className="msg__header">
        {name !== undefined && <span className="msg__name">{name}</span>}
        <span className="msg__author">
          {isUser ? 'you' : isAssistant ? 'assistant' : isSystem ? 'system' : role}
        </span>
      </div>

      {content !== null && content !== '' && (
        <div className="msg__content">{content}</div>
      )}

      {tool_calls !== undefined && tool_calls.length > 0 && (
        <ToolCallList calls={tool_calls} />
      )}

      {content === null && tool_calls === undefined && (
        <div className="msg__empty">(no content)</div>
      )}
    </div>
  );
}
