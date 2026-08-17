import { describe, expect, it } from 'vitest';
import { ApprovalError, ApprovalRegistry, derivePending } from '../src/approvals.js';
import type { TranscriptApprovalDecision, TranscriptApprovalRequest } from '../src/types.js';

describe('ApprovalRegistry', () => {
  it('registers a pending approval with an id and timestamp', () => {
    const registry = new ApprovalRegistry();
    const approval = registry.register({
      sessionId: 's1',
      summary: 'spend connects',
      detail: 'bid on a fixed-scope job',
      amountUsd: 1.5,
    });
    expect(approval.id).toBeTruthy();
    expect(approval.status).toBe('pending');
    expect(approval.createdAt).toBeTruthy();
    expect(registry.pending()).toEqual([approval]);
  });

  it('keeps a caller-supplied id when given one', () => {
    const registry = new ApprovalRegistry();
    const approval = registry.register({ id: 'my-id', sessionId: 's1', summary: 'x' });
    expect(approval.id).toBe('my-id');
  });

  it('decide marks the approval and clears it from pending', () => {
    const registry = new ApprovalRegistry();
    const approval = registry.register({ sessionId: 's1', summary: 'x' });
    const decided = registry.decide(approval.id, { approved: true, note: 'go ahead' });
    expect(decided.status).toBe('approved');
    expect(decided.note).toBe('go ahead');
    expect(decided.decidedAt).toBeTruthy();
    expect(registry.pending()).toEqual([]);
  });

  it('decide with approved=false records denied', () => {
    const registry = new ApprovalRegistry();
    const approval = registry.register({ sessionId: 's1', summary: 'x' });
    expect(registry.decide(approval.id, { approved: false }).status).toBe('denied');
  });

  it('decide on an unknown id throws ApprovalError', () => {
    expect(() => new ApprovalRegistry().decide('nope', { approved: true })).toThrowError(
      ApprovalError,
    );
  });

  it('decide twice throws ApprovalError', () => {
    const registry = new ApprovalRegistry();
    const approval = registry.register({ sessionId: 's1', summary: 'x' });
    registry.decide(approval.id, { approved: true });
    expect(() => registry.decide(approval.id, { approved: true })).toThrowError(/already/);
  });
});

describe('derivePending', () => {
  const request = (id: string): TranscriptApprovalRequest => ({
    kind: 'approval_request',
    id,
    sessionId: 's1',
    summary: `request ${id}`,
    detail: '',
    createdAt: '2026-08-17T00:00:00.000Z',
  });
  const decision = (id: string, approved: boolean): TranscriptApprovalDecision => ({
    kind: 'approval_decision',
    id,
    approved,
    note: '',
    decidedAt: '2026-08-17T00:01:00.000Z',
  });

  it('derives pending approvals from requests without a matching decision', () => {
    const pending = derivePending('s1', [
      request('a'),
      request('b'),
      decision('a', true),
      { kind: 'message', role: 'user', content: 'x' },
    ]);
    expect(pending.map((p) => p.id)).toEqual(['b']);
    expect(pending[0]?.summary).toBe('request b');
  });

  it('a denied decision also closes the request', () => {
    const pending = derivePending('s1', [request('a'), decision('a', false)]);
    expect(pending).toEqual([]);
  });

  it('ignores entries from other sessions', () => {
    const other: TranscriptApprovalRequest = { ...request('a'), sessionId: 's2' };
    expect(derivePending('s1', [other])).toEqual([]);
  });
});
