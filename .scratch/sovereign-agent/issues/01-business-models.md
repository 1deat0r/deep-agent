# 01 — Business models: what does the sovereign agent earn from?

Type: research
Status: resolved

## Question

Which 3 concrete business models can a self-directed coding agent run for its
owner with positive margin after covering its own API costs? Constraints:
owner approves every real-money action; everything starts paper/dry-run; the
agent's edge is software + automation (it runs on the owner's machine with a
persistent Python kernel and web access), not capital; no gray-area schemes
(fake reviews, click fraud, spam). Each proposal needs a dry-run plan with
measurable success criteria, unit economics (token cost vs revenue with
sourced market rates), the owner-side accounts/rails required, and risks/ToS
constraints.

→ `research/business-models.md`.

## Answer

Resolved 2026-08-17 on the user's pick after reviewing the research:

- **Run Model 1 (contract software delivery, Upwork/Fiverr) now** — dry-run:
  3–5 unpaid sample builds from real public postings, owner-scored; then
  capped real bids with owner approval on every submission; promote on
  ≥4/5 sample builds acceptable, ~20–30% response rate, zero negative
  feedback. Economics: ~$10–30/mo tokens vs $50–500/job after platform fees.
- **Run Model 3 (systematic algo-trading) paper in parallel** — backtest gate
  (beat SPY net of modeled costs, no lookahead) then 30–60 paper days on the
  broker sandbox with drawdown/alpha/trade-count criteria before any live
  order; every live order owner-approved.
- Model 2 (bug bounty) stays on the shelf — revisit if Model 1 stalls.

The research deliverable: `research/business-models.md` (all figures sourced
to primary pages). Follow-on tickets: Model 1 dry-run plan, Model 3 paper
infrastructure.
