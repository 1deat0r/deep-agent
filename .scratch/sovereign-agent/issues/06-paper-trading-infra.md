# 06 — Model 3 paper-trading infrastructure plan

Type: task
Status: resolved

## Question

Spec the Model 3 paper phase per the research (`research/business-models.md`
§Model 3): a backtest gate (beat benchmark net of modeled slippage/commissions,
no lookahead bias, multiple regimes) and a broker paper-trading phase (Alpaca
paper sandbox, 30–60 trading days, drawdown/alpha/trade-count promotion
criteria). Deliver the plan plus any core scaffolding the harness/session
needs. Real-money steps (broker account, API keys, live enablement) stay
owner-approved.

## Answer — the paper-trading plan

**Phase A — backtest gate (built).** The engine ships as
`packages/backtest` (`@deep-agent/backtest`): `runBacktest({ candles, strategy,
feeBps, slippageBps })` — decisions at the close see only `history[0..i]`
(lookahead-proof by construction), fills at the next open with slippage and
fees, metrics vs buy-and-hold benchmark (totalReturn, benchmarkReturn,
sharpe, maxDrawdown, tradeCount). 13 tests. The gate itself is
`promotionGate(regimes, criteria)` — every regime must beat its benchmark net
of modeled costs (min alpha), hold the drawdown cap, and trade enough for
significance; defaults 2 regimes / 30 trades per regime / -20% max drawdown /
1% net alpha; per-regime failure reasons. 19 tests total. A strategy promotes
past the gate only by passing it across ≥2 historical regimes supplied by the
strategy developer. Data source (free first): Alpaca Basic (IEX real-time +
delayed SIP) or the free tier for historical bars — owner sets up the data
feed in the session workspace, not in this repo.

**Phase B — broker paper (next, approval-gated at setup).** Owner creates an
Alpaca account (paper sandbox, $0 minimum) and issues paper-only API keys —
that step is a real-money-adjacent action and goes through the approval gate.
The agent then runs the strategy on the paper sandbox for 30–60 trading days
with hard risk rails in code: max position size, max daily loss, kill switch,
no margin/shorting unless opted in. Nightly P&L/drawdown/slippage report to
the owner.

**Phase C — promotion to live (owner-only).** Only after paper P&L beats SPY
net of modeled costs by a stated margin over the full window with the
drawdown cap held: owner approves enabling live trading, the starting capital
amount, and every order-size increase. Live starts at minimum size; no
scaling until live re-confirms paper.

**Owner checklist (each is an approval-gated step):** (1) Alpaca account +
paper keys; (2) live enablement; (3) capital amount; (4) any strategy/parameter
go-live; (5) order-size increases; (6) margin/shorting opt-in. The FINRA
$25k-PDT rule is obsolete (Notice 26-10, intraday margin standards effective
2026-06-04) — the research doc carries the primary sources.
