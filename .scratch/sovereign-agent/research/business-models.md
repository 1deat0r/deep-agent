# Sovereign-agent business models

Research note: three concrete business models the self-hosted **deep-agent** harness
can run for its owner, each with positive expected margin after covering its own
LLM API cost. The harness runs on the owner's Linux machine (persistent Python
kernel, web access, builds/ships software, calls an OpenAI-compatible LLM API that
the owner pays for).

Design constraints applied throughout:

1. The owner approves **every** real-money action.
2. Every model starts with a **paper / dry-run** phase with measurable success criteria.
3. The agent's edge is **software + automation + persistence**, not capital.
4. **Nothing gray-area** — no fake reviews, click fraud, spam, or platform abuse.

## Comparison table

| # | Model | Who pays | Agent's day-to-day loop | Paper / dry-run gate | Est. monthly API cost | Early monthly revenue (realistic) | Biggest risk / ToS constraint |
|---|-------|----------|-------------------------|----------------------|----------------------|----------------------------------|-------------------------------|
| 1 | Contract software delivery (Upwork / Fiverr) | Clients on freelance marketplaces | Bid on fixed-scope jobs → build → deliver → invoice | 3–5 unpaid sample builds + proposal/close-rate vs. target | ~$10–30 | ~$200–1,000 | Platform identity rules; off-platform-payment & fake-review bans; lumpy win rate |
| 2 | Bug-bounty research automation (HackerOne / Bugcrowd) | Program owners (vendors) | Watch in-scope assets → fuzz/audit → write report → submit | Valid-report % on practice/OWASP targets over N weeks | ~$10–50 | ~$100–1,000 (lumpy, bounty-dependent) | Must be authorized/in-scope (CFAA); no destructive testing; payout only on valid reports |
| 3 | Systematic algo-trading via broker API (Alpaca / IBKR) | Market P&L in the owner's account | Paper-trade strategy → monitor → small live orders | Paper P&L vs. benchmark (e.g. SPY) over 30–60 days | ~$10–30 + data | 0 to small positive (variable) | Market risk / loss of capital; FINRA PDT $25k rule; data-subscription costs |

> Numbers above are planning ranges derived below; every dollar figure is either
> sourced to a primary page or explicitly flagged as an assumption.

## Cross-cutting: what the agent's own work costs (LLM tokens)

The single most important fact for all three models is that the agent's *own*
inference bill is tiny relative to any real revenue, even after DeepSeek's
August 2026 price change.

**Current DeepSeek API pricing** (effective 2026-08-17; the official pricing page is
<https://api-docs.deepseek.com/quick_start/pricing/>). DeepSeek replaced flat
pricing with **peak / off-peak ("峰谷") pricing**, off-peak being half the peak
rate, peak window 9:00–14:00 Beijing time ([official announcement as reported by Tencent News](https://news.qq.com/rain/a/20260817V03S1500), [TechWeb](https://www.techweb.com.cn/it/2026-08-17/2978269.shtml)):

| Model | Period | Input cache-hit | Input cache-miss | Output |
|-------|--------|-----------------|------------------|--------|
| V4-Flash | off-peak | ¥0.05 | ¥1.5 | ¥4.5 |
| V4-Flash | peak | ¥0.10 | ¥3.0 | ¥9.0 |
| V4-Pro | off-peak | ¥0.15 | ¥4.5 | ¥13.5 |
| V4-Pro | peak | ¥0.30 | ¥9.0 | ¥27.0 |

(¥ = CNY per 1M tokens; ≈ $0.14/¥ at ~7.2 CNY/USD. So V4-Flash cache-miss input
is ≈ $0.21–0.42 per 1M tokens, output ≈ $0.63–1.25 per 1M tokens.)

**Assumed monthly agent workload** (assumption, flag for owner calibration): one
model's loop ≈ 30 turns/day, ~50k input tokens + ~2k output tokens per turn
(long context + transcript + tool results), 30 days → **~45M input + ~1.8M output
tokens/month**.

- At V4-Flash off-peak: 45M × $0.21 + 1.8M × $0.63 ≈ **$10.6/month**.
- Blended (some peak, occasional V4-Pro for hard reasoning): **≈ $15–30/month**.
- Hard upper bound (heavy V4-Pro peak usage): **≈ $50/month**.

Conclusion used below: the agent's full-time monthly inference cost is roughly
**$10–50**. That is the entire "cost of goods" for the software+automation edge.
_(Owner should re-confirm the exact live rate on the pricing page at setup —
DeepSeek pricing moved 10–11× upward for some tiers on 2026-08-17.)_

---

<!-- MODEL SECTIONS APPENDED BELOW -->
