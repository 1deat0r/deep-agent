# Sovereign Agent

## Destination

deep-agent runs as a self-directed earner: autonomous goal execution that
doesn't stall on user messages, cost accounting with hard budget caps, and a
researched, owner-approved business model — all under one standing guardrail:
**every real-money action pauses for explicit user approval.** The user owns
the accounts and pays the API bill; the agent's job is to earn enough margin
that its own costs are covered.

## Implementation status (2026-08-17)

- **02 sovereign mode** — implemented: `sovereign: true` on goal creation,
  never-pause semantics, heartbeat re-arm (`heartbeatMs`, default 5 min),
  RLM + system prompt + docs updated, host tests green.
- **03 wallet** — implemented: `packages/host/src/wallet.ts` (costUsd, JSONL
  persistence, validation), charged per model call with estimate fallback,
  budget-zero → goal blocked, `GET /api/wallet`, Settings shows the balance.
- **04 approval gate** — implemented: `packages/host/src/approvals.ts`
  (registry + transcript-derived pending), `waiting_approval` goal state,
  `rlm.approval.request(...)`, `GET/POST /api/approvals`, GUI approve/deny
  cards. 105/105 tests, typechecks clean.
- **05 Model 1 dry-run plan, 06 Model 3 paper infrastructure** — the
  sovereign agent's first missions (tickets to file when it starts).
- **05 — Model 1 dry-run: DONE (2026-08-17).** 3/3 real public specimens
  built and judged acceptable: soroban-defi-analytics#4 CSV export (fixed a
  pre-existing broken build on the way), pynventory#76 helper tests,
  pynventory#77 CI workflow. Deliverables under `dry-run/build-*/`.
  → `issues/05-model1-dry-run.md`.
- **06 — Model 3 paper infra: DONE (2026-08-17).** Backtest gate built as
  `packages/backtest` (lookahead-proof engine, cost modeling, benchmarked
  metrics, 13 tests); paper-broker and live phases specified with
  owner-approval checkpoints for every real-money step.
  → `issues/06-paper-trading-infra.md`.

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
