// Real-money approval gate (sovereign-agent ticket 04): the registry holds
// pending approvals in memory; the transcript is the durable source of truth
// and derivePending rebuilds the pending set after a restart.
import { randomUUID } from 'node:crypto';
import type { Approval, TranscriptEntry } from './types.js';

export interface ApprovalRequestInput {
  id?: string;
  sessionId: string;
  summary: string;
  detail?: string;
  amountUsd?: number;
}

export interface ApprovalDecision {
  approved: boolean;
  note?: string;
}

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export class ApprovalRegistry {
  private readonly approvals = new Map<string, Approval>();

  register(input: ApprovalRequestInput): Approval {
    const id = typeof input.id === 'string' && input.id !== '' ? input.id : randomUUID();
    if (this.approvals.has(id)) throw new ApprovalError(`approval ${id} already exists`);
    const approval: Approval = {
      id,
      sessionId: input.sessionId,
      summary: input.summary,
      detail: input.detail ?? '',
      ...(input.amountUsd !== undefined ? { amountUsd: input.amountUsd } : {}),
      status: 'pending',
      note: '',
      createdAt: new Date().toISOString(),
    };
    this.approvals.set(id, approval);
    return approval;
  }

  pending(): Approval[] {
    return [...this.approvals.values()].filter((a) => a.status === 'pending');
  }

  get(id: string): Approval | undefined {
    return this.approvals.get(id);
  }

  decide(id: string, decision: ApprovalDecision): Approval {
    const approval = this.approvals.get(id);
    if (!approval) throw new ApprovalError(`no such approval: ${id}`);
    if (approval.status !== 'pending') throw new ApprovalError(`approval ${id} already decided`);
    approval.status = decision.approved ? 'approved' : 'denied';
    approval.note = decision.note ?? '';
    approval.decidedAt = new Date().toISOString();
    return approval;
  }
}

/**
 * Rebuild the pending set for a session from its transcript: every
 * approval_request without a matching approval_decision is still pending.
 */
export function derivePending(
  sessionId: string,
  entries: TranscriptEntry[],
): Approval[] {
  const decided = new Set<string>();
  const pending: Approval[] = [];
  for (const entry of entries) {
    if (entry.kind === 'approval_decision') {
      decided.add(entry.id);
    } else if (entry.kind === 'approval_request' && entry.sessionId === sessionId) {
      pending.push({
        id: entry.id,
        sessionId: entry.sessionId,
        summary: entry.summary,
        detail: entry.detail,
        ...(entry.amountUsd !== undefined ? { amountUsd: entry.amountUsd } : {}),
        status: 'pending',
        note: '',
        createdAt: entry.createdAt,
      });
    }
  }
  return pending.filter((approval) => !decided.has(approval.id));
}
