# 04 — Real-money approval gate

Type: task
Status: resolved

## Question

The standing guardrail: every real-money action pauses for explicit user
approval. What is the protocol shape? Constraint from AGENTS.md: one built-in
tool (`ipython`) — so the agent expresses "I need approval for X" through the
kernel (`host_request`), the host flips the goal into a waiting-for-approval
state, the user approves/denies via the GUI/API, and the outcome returns to
the model. The transcript must record the request and the decision
(append-only). Record the exact protocol (request kind, payload, state
transition, transcript entries) as this ticket's answer.

## Answer

Resolved 2026-08-17; the user confirmed shared understanding.

- **Kernel → host**: `rlm.approval.request({ id, summary, detail, amountUsd? })`
  — a new `host_request` kind `approval_request` (the model's only way to ask;
  one-tool invariant intact).
- **Host state**: if the session has an active goal, the goal status becomes
  `waiting_approval` (rounds stop until decided). The transcript appends an
  `approval_request` entry (id, summary, detail, amountUsd, createdAt).
- **User surface**: the GUI shows a pending-approval card with Approve/Deny;
  the API adds `GET /api/approvals` (pending list) and
  `POST /api/approvals/:id` (`{ approve: boolean, note?: string }`).
- **Outcome**: the transcript appends an `approval_decision` entry (id,
  approve, note, decidedAt); the model receives it as a message and the goal
  resumes (approve) or records the denial and adapts.
- **Outside goals**: in an interactive turn the request is still recorded and
  surfaced; the decision arrives as a message that wakes the session.
