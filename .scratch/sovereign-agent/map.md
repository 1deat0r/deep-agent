# Sovereign Agent

## Destination

deep-agent runs as a self-directed earner: autonomous goal execution that
doesn't stall on user messages, cost accounting with hard budget caps, and a
researched, owner-approved business model — all under one standing guardrail:
**every real-money action pauses for explicit user approval.** The user owns
the accounts and pays the API bill; the agent's job is to earn enough margin
that its own costs are covered.

## Notes

- Domain: `AGENTS.md` (one built-in tool: `ipython`; host-owned state in TS;
  kernel reaches the host only through `host_request`; transcript is
  append-only), `docs/architecture.md`, `docs/rlm-programming-model.md`,
  `packages/host/CONTEXT.md`.
- Standing facts: goals already auto-continue rounds up to `maxRounds` and
  pause when a direct user message interrupts; `maxAutoRounds`,
  `maxToolIterations`, `execTimeoutMs` exist in config; token estimation
  exists (`tokens.ts`); the CLI/GUI already expose interrupt.
- Tracker: local markdown (`.scratch/`), conventions in
  `docs/agents/issue-tracker.md`.

## Decisions so far

- **Guardrail (user, 2026-08-17): every real-money action pauses for explicit
  user approval.** Autonomy applies to work (research, building, paper
  trading, writing); moving or risking real money is never agent-only.
- **Scope (user, 2026-08-17): the agent researches and proposes 3 concrete
  business models; the user picks one before any real money moves.**

## Not yet specified

- Sovereign goal-mode semantics (ticket 02).
- Cost accounting + wallet design (ticket 03).
- Approval-gate protocol shape (ticket 04).

## Out of scope

- The agent holding payment methods or spending the user's money directly —
  the user pays the API bill and holds every account.
- Unbounded profit-maximization without domain and guardrails.
