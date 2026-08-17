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
| 3 | Systematic algo-trading via broker API (Alpaca / IBKR) | Market P&L in the owner's account | Paper-trade strategy → monitor → small live orders | Paper P&L vs. benchmark (e.g. SPY) over 30–60 days | ~$10–30 + data | 0 to small positive (variable) | Market risk / loss of capital (unproven edge); data-subscription costs; FINRA PDT $25k rule replaced June 2026 |

> Numbers above are planning ranges derived below; every dollar figure is either
> sourced to a primary page or explicitly flagged as an assumption.

## Cross-cutting: what the agent's own work costs (LLM tokens)

The single most important fact for all three models is that the agent's *own*
inference bill is tiny relative to any real revenue, even after DeepSeek's
August 2026 price change.

**Current DeepSeek API pricing** (effective 2026-08-17; the official pricing page is
<https://api-docs.deepseek.com/quick_start/pricing/>). DeepSeek replaced flat
pricing with **peak / off-peak ("峰谷") pricing**, off-peak being half the peak
rate, peak window 9:00–14:00 Beijing time ([official announcement as reported by Tencent News](https://news.qq.com/rain/a/20260817V03S1500), [TechWeb](https://www.techweb.com.cn/it/2026-08-17/2978269.shtml)) — the numbers below are quoted from those announcement reports; the canonical live table is the pricing page above, and the owner should re-read it at setup:

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

## Model 1 — Contract software delivery (Upwork / Fiverr)

### 1. What it is, who pays, how the agent runs it day-to-day

The agent sells **small, fixed-scope software work** — bug fixes, one-off scripts,
small features, integrations, data-pipeline cleanup — on a freelance marketplace.
**Who pays:** end clients on Upwork or Fiverr, through the platform's escrow.

**Concrete loop (per job):**

1. **Monitor** — poll the marketplace's job feed (via API where available, or the
   site) for fixed-scope jobs in the owner's chosen niche (Python/automation,
   TypeScript, web scraping, data cleaning, CLI tools).
2. **Draft proposal** — the agent writes the proposal text; **the owner approves
   every submission** (constraint 1) and pays the Connects cost to bid.
3. **Build** — once awarded, the agent does the work in its persistent kernel,
   produces the deliverable (repo + tests + README), and runs it against the
   client's stated acceptance criteria.
4. **Ship & get paid** — the owner reviews the deliverable, uploads it to the
   platform, and the client releases escrow. The owner, not the agent, holds the
   account and the bank rail.

The edge is exactly the harness's nature: the agent does the build and test work
24/7 for ~$10–30/month of tokens, so the *effective* cost of labor is near zero.

### 2. Paper / dry-run phase (before any real money)

The goal is to prove the agent can take a spec to a correct, delivered artifact
*without* risking the owner's marketplace reputation or spending on bids.

- **Build 3–5 unpaid sample jobs end-to-end** from real, public job postings
  (scrape the posting text, build the deliverable to its stated acceptance
  criteria, but do **not** submit/bid). Success = a correct, tested deliverable
  against the spec, scored by the owner.
- **Measure proposal efficiency** on a small, capped number of real bids only
  after the build quality gate passes.
- **Promote-to-real criteria (measurable):**
  - ≥ 4 of 5 sample builds judged correct/acceptable by the owner; **and**
  - on the first N real bids, a response/interview rate ≥ ~20–30%; **and**
  - zero negative client feedback on the first 2–3 completed (low-value) jobs;
  - any single ToS violation (off-platform payment, review solicitation) = **hard stop**, permanent.

### 3. Unit economics

**Cost side (the agent's tokens):** ~$10–30/month (see the cross-cutting section).

**Platform fees (primary sources):**

- **Upwork** — the current freelancer service fee is **variable, 0%–15% per
  contract**, fixed at contract start; Enterprise-client contracts are "typically
  … 10%", Direct Contracts (a client you brought) are **5%** (0% for Freelancer
  Plus members), and Any Hire / Upwork Payroll are **0%**.
  ([Upwork — Learn about the Freelancer Service Fee](https://support.upwork.com/hc/en-us/articles/211062538-Learn-about-the-Freelancer-Service-Fee); [Direct Contracts](https://support.upwork.com/hc/en-us/articles/360025040794-Direct-Contracts-bring-a-client-to-Upwork)).
  Note: the older 20%→10%→5% lifetime-billing schedule is no longer on the page —
  assume a per-contract fee shown at proposal time.
- **Upwork Connects (bidding cost):** "$0.15 (USD) each," count "varies per job"
  ([Upwork — Understanding and using Connects](https://support.upwork.com/hc/en-us/articles/211062898-Understanding-and-using-Connects)).
- **Upwork minimums:** "$3.00 USD per hour … and $5.00 USD for fixed-price
  projects" ([Upwork minimum rates](https://support.upwork.com/hc/en-us/articles/17974503304851--Our-minimum-hourly-and-fixed-price-rates)).
- **Fiverr** — seller keeps **80%** of each order, i.e. a **20% commission**
  ([Fiverr — Payments Terms and Conditions](https://www.fiverr.com/content/payments-terms-and-conditions)).

**Revenue assumptions (flagged — neither platform publishes official category
averages):** small fixed-scope dev jobs realistically land at **$50–$500** each.
A conservative early cadence of **2 won jobs/month at $150 average** = $300 gross.

**Monthly P&L example (Fiverr, worst-case fee):** $300 gross − 20% ($60) −
Connect/bid costs ≈ $240 − ~$20 tokens ≈ **~$220/month net**. Even one $200
Upwork job/month (10% fee) clears ~$180 net against ~$10–30 tokens. **Positive
margin is not the risk — win rate and reputation are.**

### 4. What the owner must set up and approve

- **Account + identity:** the owner opens the Upwork and/or Fiverr account in
  their own name (marketplaces require human identity verification; the agent
  must not be the account holder).
- **Payment rail:** connect the owner's bank/PayPal for payouts.
- **Per-action approvals (each is a real-money or reputation step):** (a) every
  proposal/bid submitted (and the Connects spent); (b) every contract accepted;
  (c) every deliverable uploaded; (d) any hourly-contract time logged. The agent
  never touches the payout rail directly.

### 5. Biggest risks + platform ToS constraints

- **Off-platform payment / circumvention (Upwork):** "Getting paid outside Upwork
  violates our Terms of Service and can result in permanent loss of your account";
  "Sharing contact information before a contract begins and taking payments off
  platform can result in … permanent closure of your Upwork account."
  ([Upwork — Circumvention](https://support.upwork.com/hc/en-us/articles/360052511133-Circumvention-and-why-it-s-against-the-rules)).
- **Fake reviews / feedback building (Upwork):** "manipulating Upwork feedback
  through fake jobs or biased reviews—violates Upwork's Terms of Service and can
  lead to account suspension. This includes paying for feedback, reciprocal
  agreements, or threats."
  ([Upwork — What is feedback building](https://support.upwork.com/hc/en-us/articles/17989850384531--What-is-feedback-building)).
- **Fiverr review manipulation:** "Attempts to manipulate the review system …
  are prohibited and may result in immediate permanent suspension"; also banned:
  "Buy, trade, solicit, or otherwise obtain feedback for yourself … to artificially
  inflate your rating." ([Fiverr — Community Standards](https://help.fiverr.com/hc/en-us/articles/32242973123985-Our-Community-Standards)).
- **Fiverr off-platform:** "Users may not submit proposals or solicit parties
  introduced through Fiverr to contract, engage with, or pay outside of Fiverr."
  ([Fiverr — Terms of Service](https://www.fiverr.com/legal-portal/legal-terms/terms-of-service)).
- **Business risks:** lumpy win rate (the fee is fine, but there is no guaranteed
  pipeline); the agent must never fabricate work history, spam proposals, or
  solicit reviews — all of which are exactly the gray-area behaviors this design
  forbids.

## Model 2 — Bug-bounty research automation (HackerOne / Bugcrowd)

### 1. What it is, who pays, how the agent runs it day-to-day

The agent runs **authorized vulnerability research** against companies that have
explicitly opened a bug-bounty or VDP (vulnerability-disclosure) program, and
submits valid reports for cash bounties. **Who pays:** the program owner (the
"Security Team" / organization), never the platform — "The amount of each bounty
payment will be determined by the Security Team"
([HackerOne Disclosure Guidelines](https://www.hackerone.com/terms/disclosure-guidelines)).

**Concrete loop:**

1. **Select a program & read scope** — the agent reads the program's *in-scope
   targets* and rules and only ever touches those assets.
2. **Hunt** — automated fuzzing / code review / misconfiguration checks against
   in-scope targets, plus manual-style reasoning in the kernel for logic bugs
   (authz, IDOR, injection).
3. **Triage & reproduce** — confirm each finding is real, reproducible, and
   non-duplicate before writing it up.
4. **Draft report, owner submits** — the agent writes a report with "clear,
   concise reproducible steps or a working proof-of-concept"; **the owner reviews
   and is the one who submits** (the required human-in-the-loop — see §5).
5. **Iterate on triage** — respond to the Security Team's questions, adjust the
   report, and collect the bounty when validated.

### 2. Paper / dry-run phase (before any real money)

The goal is to prove a **valid-report rate** without burning real program trust.

- **Practice targets:** run the tooling only against (a) deliberately vulnerable
  labs the owner authorizes (e.g., self-hosted DVWA/OWASP Juice Shop/WebGoat) and
  (b) targets the owner owns (their own sites/repos).
- **Measure, over ~4–8 weeks:** precision = valid/unique findings ÷ reports
  drafted, and recall = real seeded bugs found ÷ bugs planted in the lab.
- **Promote-to-real criteria (measurable):**
  - ≥ ~70–80% of lab-seeded bugs found by the automated pass; **and**
  - ≥ ~80% of drafted reports are true positives on practice targets (low
    false-positive rate — HackerOne bans "large volumes of low-signal reports");
  - then open on **one** low-competition program with a small in-scope target and
    a hard cap on submissions/week; promote further only if the first valid
    bounty lands without a single out-of-scope test or policy strike.

### 3. Unit economics

**Cost side:** ~$15–50/month of tokens (security work runs heavier: more output
tokens for fuzzing scripts + report prose, and more V4-Pro reasoning).

**Revenue side (primary sources, but note lumpiness):**

- **Bugcrowd** publishes a reward-range table ("suggestions, not absolutes"):
  **P1 Low $3,500–4,500 / High $11,000–20,000; P2 $1,500–7,500; P3 $500–2,500;
  P4 $175–600**; their hackers page also shows **"Average P1 reward $3,000"** and
  **"$200M+ rewarded to hackers."**
  ([Bugcrowd — What is a bug bounty program](https://www.bugcrowd.com/blog/what-is-a-bug-bounty-program/); [Bugcrowd — Hackers](https://www.bugcrowd.com/hackers/)).
- **HackerOne** does not publish a platform-wide dollar range; its all-time figure
  is **$300M+ in total rewards (Oct 2023), 30 hackers over $1M lifetime, one over
  $4M**, top payout **$100,050**
  ([HackerOne press release](https://www.hackerone.com/press-release/hackers-surpass-300-million-all-time-earnings-hackerone-platform)).
- **No researcher fee** — money flows *to* the researcher; the platform's fee is
  charged to the program ("The awarded amount, including your applicable fees,
  will be deducted from your balance" — [HackerOne — Awarding bounties](https://docs.hackerone.com/en/articles/8524543-awarding-bounties)).

**P&L reality:** a single valid **P4 ($175–600)** or **P3 ($500–2,500)** per
month clears the $15–50 token bill several times over. **But income is lumpy and
skewed** — most researchers earn $0 in a given month. Positive *expected* margin
therefore depends entirely on the paper phase proving a repeatable valid-report
rate; do not count any revenue until a bounty is actually paid.

### 4. What the owner must set up and approve

- **Researcher accounts:** HackerOne and/or Bugcrowd account in the owner's name
  (Bugcrowd payouts require "additional verification and tax information"
  ([Bugcrowd — Standard Disclosure Terms](https://www.bugcrowd.com/resources/hacker-resources/standard-disclosure-terms/))).
- **Per-action approvals:** (a) which program to target (owner confirms the scope
  and the program's ToS); (b) every report before submission — the owner is the
  mandatory human-in-the-loop reviewer; (c) any out-of-band contact with a team;
  (d) any tax/payment info.
- **Guardrails the agent must obey:** never test anything not listed in scope;
  never run destructive/unsafe tests; never submit without owner sign-off.

### 5. Biggest risks + platform ToS constraints

The single dominant risk is **legal**: testing systems you are not authorized to
test is a computer-fraud / unauthorized-access offense (CFAA in the US), so the
agent must test **only** assets a program explicitly opens. Platform policies
encode this directly:

- **In-scope only (HackerOne):** "Respect the rules. Operate within the rules set
  forth by the Security Team…" and "must not perform testing… without prior
  authorization from the Customer."
  ([HackerOne Disclosure Guidelines](https://www.hackerone.com/terms/disclosure-guidelines); [HackerOne Code of Conduct](https://www.hackerone.com/policies/code-of-conduct)).
- **No unsafe testing:** "Community Members must not perform testing which might
  be deemed 'unsafe' without prior authorization…" (covers DoS, altering production
  data, dumping databases).
  ([HackerOne Code of Conduct](https://www.hackerone.com/policies/code-of-conduct)).
- **In-scope only (Bugcrowd):** "Testing should be performed only on systems
  listed under the program brief 'Targets' section. Any other systems are Out Of
  Scope." ([Bugcrowd — Standard Disclosure Terms](https://www.bugcrowd.com/resources/hacker-resources/standard-disclosure-terms/)).
- **Automation is explicitly regulated (HackerOne Code of Conduct):** "Hackbots
  must not operate in a fully autonomous manner…"; "AI-assisted testing must not
  result in unsafe testing, out-of-scope activity, excessive traffic…"; and it
  prohibits "Generating large volumes of low-signal or non-actionable reports"
  and "hallucinated or misleading technical details."
  ([HackerOne Code of Conduct](https://www.hackerone.com/policies/code-of-conduct)).

  **This is a feature, not a bug, for this design:** constraint 1 (owner approves
  every real-money action) already forces the human-in-the-loop that HackerOne
  requires. The agent does the hunting; the owner does the review/submit. There
  is no gray area because only authorized, in-scope, honest, reproducible reports
  are ever filed.

## Model 3 — Systematic algo-trading via a broker API (Alpaca / IBKR)

> Honest framing up front: this is the one model where the agent's edge (a
> software trading strategy) is **unproven**, and where the owner's own capital —
> not just API cost — is at risk. It is included because it maps *perfectly* onto
> the paper→real constraint, but it must stay gated behind a paper phase that a
> strategy has to actually pass. Do not treat trading P&L as "expected revenue"
> the way a freelance fee or a bounty is.

### 1. What it is, who pays, how the agent runs it day-to-day

The agent runs a small, fully systematic strategy — mean-reversion, momentum, or
cross-asset arbitrage on US equities/ETFs — through a broker's API, in the
owner's own account. **Who pays:** there is no counterparty customer; the "payoff"
is the strategy's market P&L, and the agent's real costs are its own tokens,
market-data fees, and commissions.

**Concrete loop:**

1. **Research/backtest (offline)** — the agent develops and backtests strategies
   against historical data in its persistent kernel; no money moves.
2. **Paper-trade live** — run the strategy against the broker's free paper-trading
   sandbox (Alpaca paper supports "funds up to $1m" virtual) with live data.
3. **Monitor** — the persistent process watches positions, risk limits, and
   market conditions around the clock (this 24/7 persistence is the harness's
   genuine edge over a human trader).
4. **Live, small** — only after promotion, place small, owner-approved real orders;
   every order, size increase, and strategy change goes through owner approval.
5. **Report** — nightly P&L, drawdown, and slippage reports for the owner.

### 2. Paper / dry-run phase (before any real money)

- **Backtest gate:** strategy must beat its benchmark net of estimated slippage
  and commissions, across multiple regimes, without lookahead bias.
- **Paper-trading gate (measurable):** run on the broker's paper sandbox for a
  fixed **30–60 trading days**; promote to real **only if** paper P&L beats the
  benchmark (e.g. SPY) **net of modeled costs** by a stated margin, with drawdown
  under a stated cap, **and** ≥ N trades executed to make the result statistically
  meaningful (not 2 lucky trades).
- **Promote-to-real criteria (measurable):** e.g. ≥ +X% alpha over SPY over 60
  paper days, max drawdown ≤ Y%, ≥ 60 trades; start live at the **minimum** order
  size and do not scale until live results re-confirm paper.

### 3. Unit economics

**Cost side:**

- Agent tokens: ~$10–30/month (monitoring + strategy iteration).
- Market data: **free tier is often enough to start.** Alpaca's free **Basic**
  plan (default for paper *and* live) gives real-time **IEX** + 15-min delayed SIP
  ([Alpaca — About Market Data API](https://docs.alpaca.markets/v1.1/docs/about-market-data-api));
  full real-time across all US exchanges is **Algo Trader Plus, $99/month**
  ([Alpaca — algorithmic trading](https://alpaca.markets/algotrading)). IBKR free
  tier = delayed data + 100 snapshots/mo + real-time Cboe One/IEX; its paid
  streaming bundles start at **$4.50–$10/month** (non-professional)
  ([IBKR — market data pricing](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php)).
- Commissions: **$0** on Alpaca (commission-free API) or IBKR Lite; IBKR Pro
  tiered is **$0.0035/share (min $0.35)** and fixed is **$0.005/share (min $1)**
  ([IBKR — commissions on stocks](https://www.interactivebrokers.com/en/pricing/commissions-stocks.php)).
- **Total fixed cost ≈ $10–110/month** depending on data tier.

**Revenue side:** strictly = net trading P&L. There is no citable "expected
return" from a primary source; any figure is strategy-dependent. **Margin logic:**
on a $10k account, the whole ~$10–110/month cost basis is ~0.1–1.1%/year of
capital — so even a modest, repeatable edge clears it. But an edge that *doesn't*
exist loses both the cost basis **and** capital, which is exactly why the paper
gate above is mandatory.

### 4. What the owner must set up and approve

- **Brokerage account** in the owner's name: Alpaca ($0 minimum for US individuals;
  $30k initial funding for non-US/business-entity accounts — [Alpaca minimum deposit](https://alpaca.markets/support/alpaca-minimum-deposit))
  and/or IBKR ($0 account minimum — [IBKR required minimums](https://www.interactivebrokers.com/en/accounts/required-minimums.php)).
- **API credentials** issued to the agent but **read-only or order-scoped**, with
  the owner able to revoke; payout/bank rail stays owner-controlled.
- **Per-action approvals (real-money steps):** (a) enabling live trading at all;
  (b) the starting capital amount; (c) every strategy go-live and parameter change;
  (d) any order-size increase; (e) any margin use. Paper trading needs no approval
  beyond account setup.
- **Risk rails the agent must hard-code:** max position size, max daily loss,
  kill-switch, no shorting/margin unless the owner explicitly opts in.

### 5. Biggest risks + regulatory constraints

- **Loss of capital / no edge:** the dominant risk; most retail day-traders lose.
  The mitigation is the paper gate + minimum live sizing, not optimism.
- **FINRA day-trading margin rules — just changed (2026).** The old **$25,000
  pattern-day-trader minimum-equity** requirement has been **replaced in its
  entirety** by new "intraday margin standards," **effective June 4, 2026**
  (broker transition through October 20, 2027): "There's no $25,000 minimum
  equity requirement for day trading. There's no 'pattern day trader' designation
  based on counting trades."
  ([FINRA — Notice 26-10](https://www.finra.org/rules-guidance/notices/26-10); [FINRA — Understanding the New Intraday Margin Requirements](https://www.finra.org/investors/insights/intraday-margin-requirements)).
  The owner must confirm the live rule on FINRA's page and the broker's migration
  schedule — the $25k figure most blogs still cite is obsolete.
- **Data/licensing ToS:** broker and data-vendor feeds (IEX, SIP, Polygon) are
  licensed for the subscriber's own trading, with redistribution limits; the agent
  must use one licensed feed and not scrape/re-expose quotes.
- **Suitability/margin ToS:** using margin, shorting, or options requires explicit
  owner opt-in and broker approval; the agent must stay within the account's
  approved product set.
- **Slippage/execution risk:** paper fills are idealized; live fills on
  commission-free routes can differ (payment-for-order-flow), so the promotion
  criteria must be met with conservative slippage modeled in.

---

## Summary

| Model | Best fit | Why the margin holds | Biggest single risk |
|-------|----------|---------------------|---------------------|
| 1. Contract software delivery | Fastest, most predictable cash | ~$10–30 tokens vs. $50–500/job even after 20% platform fee | Win rate + reputation; platform ToS |
| 2. Bug-bounty automation | Best software/automation edge | One valid P3/P4 bounty covers tokens many times over | Lumpy/zero-income months; must stay in-scope (legal) |
| 3. Algo-trading (gated) | Best fit for the paper→real constraint | ~$10–110/mo cost basis is tiny vs. capital | Losing capital; unproven edge |

**Order of operations for the owner:** (1) stand up Model 1 or 2 first — their
revenue is not conditional on beating a market — while Model 3 runs in its paper
phase in parallel; (2) only add real-money trading after its paper gate passes;
(3) every model's "promote to real" decision is a single owner sign-off with the
measurable criteria listed above.
