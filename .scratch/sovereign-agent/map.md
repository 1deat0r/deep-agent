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
- **01 — Business model (user, 2026-08-17): Model 1 (contract software
  delivery) runs now with its dry-run gate; Model 3 (algo-trading) runs paper
  in parallel behind its backtest + 30–60-day paper gate; Model 2 shelved.**
  → `issues/01-business-models.md`, `research/business-models.md`.
- **02 — Sovereign goal mode: per-goal flag.** `sovereign: true` on goal
  creation; the goal never pauses on user messages (they append to the
  transcript and are answered at the next round boundary); heartbeat re-entry
  after a configurable idle interval (default 5 min); interrupt always stops
  it instantly. → `issues/02-sovereign-goal-mode.md`.
- **03 — Cost accounting: host-global wallet.** Provider token usage with
  `estimateTokens` fallback; `wallet: { budgetUsd, rates }` in config; spend
  appended to `<dataDir>/wallet.json`; budget zero → goal `blocked` with
  reason `budget exhausted`; `GET /api/wallet` + GUI visibility.
  → `issues/03-cost-accounting-wallet.md`.
- **04 — Approval gate: kernel request → user decision.** The model asks via
  `rlm.approval.request(...)` (host_request kind `approval_request`); goal
  status `waiting_approval`; transcript records both the request and the
  `approval_decision`; the user decides via GUI card or
  `GET/POST /api/approvals`. → `issues/04-approval-gate.md`.

## Not yet specified

- Model 1 dry-run plan (ticket 05) and Model 3 paper infrastructure
  (ticket 06) — implementation tickets for the chosen models.

## Out of scope

- The agent holding payment methods or spending the user's money directly —
  the user pays the API bill and holds every account.
- Unbounded profit-maximization without domain and guardrails.
