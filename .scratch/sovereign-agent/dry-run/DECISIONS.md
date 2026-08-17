# Decisions ledger — sovereign-agent dry-run (self-governance skill)

Append-only. Date · decision · predicted confidence · outcome · lesson.

- 2026-08-17 · Start with ticket 05 (Model 1 dry-run) before 06 (paper infra) ·
  C 4/5 · — · Impact: the user's chosen money path; fully reversible, no
  approval gates until any real-money step.
- 2026-08-17 · Deliverables + ledger live under `.scratch/sovereign-agent/dry-run/`
  in the repo (tracked, reviewable), not the session workspace · C 4/5 · — ·
  This session IS the agent; the repo scratch dir is its durable workspace and
  keeps the owner able to score builds without chasing session dirs.
- 2026-08-17 · Picked the 3 dry-run specimens from real public GitHub issues
  with bounty/help-wanted labels and explicit acceptance criteria (no
  platform interaction, no bids): (1) soroban-defi-analytics#4 CSV export
  feature, (2) pynventory#76 tests for prompt_non_negative_number,
  (3) pynventory#77 CI checks · C 4/5 · — · Rejected marketplace scraping
  (login walls, ToS risk) for public issue specs — same client-work shape,
  zero interaction.
- 2026-08-17 · Build 1: fixed the specimen's pre-existing broken build (missing
  @typescript-eslint plugin + undeclared plugin in .eslintrc) instead of
  bypassing lint · C 4/5 · ✓ correct root cause, build green · Flagging and
  fixing client repo defects is contract-dev value; bypassing lint would hide
  it.
- 2026-08-17 · Build 3: CI runs `ruff check .` but not `ruff format --check .`
  (4 files pre-existing unformatted; reformatting is out of the issue's scope)
  · C 4/5 · ✓ lint passes on current codebase · Scope discipline: keep the
  workflow green on the current code; note formatting debt to the client.
- 2026-08-17 · Ticket 06 seams chosen autonomously (user delegated decisions):
  B1 pure metrics module, B2 lookahead-proof runBacktest simulation (strategy
  receives only history[0..i]); broker API client and live data excluded from
  unit tests — they wait for owner credentials · C 4/5 · — · Seams recorded
  here so the owner can veto before any live phase; the engine itself is
  credential-free and reversible.
- 2026-08-17 · Spec-review fixes: implemented the promotion gate as code
  (promotionGate, 6 tests) rather than prose; per-turn wallet charging with
  compaction counted (spec's one-turn overrun bound honored); top-up +
  blocked→resume; sovereign flag through API/GUI · C 4/5 · ✓ all six review
  findings resolved, 128/128 tests · Review loops pay: the gate existed only
  as prose until an independent reviewer read the ticket against the diff.
