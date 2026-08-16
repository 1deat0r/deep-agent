import { EventEmitter } from 'node:events';
import type { HostEvent } from './types.js';

const REPLAY_BUFFER = 500;

/**
 * Typed pub/sub for host events, with a bounded per-session replay buffer so
 * late SSE subscribers see recent history before live events.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly buffer = new Map<string, HostEvent[]>();

  emit(event: HostEvent): void {
    const list = this.buffer.get(event.sessionId) ?? [];
    list.push(event);
    if (list.length > REPLAY_BUFFER) list.splice(0, list.length - REPLAY_BUFFER);
    this.buffer.set(event.sessionId, list);
    this.emitter.emit('event', event);
  }

  on(listener: (event: HostEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  replay(sessionId: string): HostEvent[] {
    return [...(this.buffer.get(sessionId) ?? [])];
  }
}

export function ssePayload(event: HostEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
