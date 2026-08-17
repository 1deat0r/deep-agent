# 03 — Cost accounting and wallet: how does the agent pay its way?

Type: grilling
Status: resolved

## Question

The user pays the API bill; the harness must at minimum *know what it costs*
and stop before it overruns a budget. Decisions needed: usage source (provider
usage fields vs `estimateTokens` fallback), where rates live, where the
running spend persists, and what happens when the budget hits zero.

## Answer

Resolved 2026-08-17; the user confirmed shared understanding.

- **Usage source**: provider-reported `promptTokens`/`completionTokens`
  (confirmed present in the provider's collected responses) when available,
  `estimateTokens` fallback otherwise.
- **Rates + budget**: config gains `wallet: { budgetUsd, rates: { [model]:
  { inputPerMUsd, outputPerMUsd } } }`. USD throughout. Defaults ship for the
  default provider's pricing; accuracy beyond that is the user's config.
- **Persistence**: cumulative spend persists to `<dataDir>/wallet.json` —
  one appended line per charged turn (session id, model, input/output tokens,
  cost, timestamp). Resettable by the user (delete the file).
- **Scope**: the wallet is **host-global** — root and child sessions all
  charge the same budget.
- **Enforcement**: before each turn, remaining budget ≤ 0 → the goal flips to
  `blocked` with reason `budget exhausted` (visible in the GUI, resumable
  after top-up). A turn may overshoot by at most one turn's cost — charging
  happens after the turn using its actual usage.
- **Visibility**: `GET /api/wallet` (budget, spent, remaining, per-model
  rates) and a GUI line in Settings.
