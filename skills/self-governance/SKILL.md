---
name: self-governance
description: Decision matrix for self-directed work — choosing the next action, course correction, escalation, and budget-aware planning inside a goal; load before committing to any non-trivial decision.
---

# Self-Governance Decision Matrix

A methodical loop for deciding what to do next and committing to the smartest
option. Run the whole loop for any non-trivial decision: task selection,
course correction, escalation, or budget allocation. Small reversible steps
(dry-run work, reading, building) still get steps 1, 4, and 6 — the gates and
the commit line — but skip full scoring.

## The loop

**1. Ground.** Restate the active objective in one line and confirm the action
under consideration traces to it. *Complete when:* every option on the table
traces to the objective; options that don't are dropped now, not later.

**2. Read state.** Check the transcript tail, open approvals, and the wallet
(`await rlm.wallet.status()`). *Complete when:* you can state remaining budget
and any waiting decisions before choosing.

**3. Generate options.** List at least 3 distinct candidates — including
"do the smallest next increment", "wait", and "escalate" as honest options.
*Complete when:* 3+ candidates written down.

**4. Run the gates, in order.** A gate that fails removes the candidate; the
money gate means stop and wait, never proceed.

- **Approval gate** — an action that moves real money, spends funds, or
  commits an account to an irreversible external effect → `await
  rlm.approval.request(...)` and wait for the user's decision.
- **Scope gate** — outside the delegated objective → drop.
- **Budget gate** — wallet remaining ≤ 0 → stop and report; do not borrow
  work against a top-up that hasn't happened.
- **Honesty gate** — deception, spam, fake reviews, unauthorized access →
  drop permanently; no re-scoring, no reframing.

**5. Score the survivors.** Rate each candidate 1–5 on:

- **Impact** — objective progress if it succeeds.
- **Confidence** — your estimated probability of success, backed by evidence
  (tests, docs, prior results) in one clause. State it honestly; the ledger
  checks.
- **Cost** — inverse: 5 is cheap in tokens, wall-clock, and risk.
- **Reversibility** — 5 is trivially undoable, 1 is a one-way door.
- **Information value** — how much uncertainty it resolves (the tie-breaker).

Priority = Impact × Confidence × Cost × Reversibility. Information value
breaks ties; prefer the higher-information, lower-cost probe.

**6. Commit and act.** Pick the top scorer, write one line in the transcript —
`Decision: <X> because <reason>; confidence <C/5>` — then execute the smallest
verifiable increment. *Complete when:* the increment produced a checkable
artifact or result you can score in step 7.

**7. Close the loop.** Record the outcome against your prediction in the
session's `DECISIONS.md` ledger: date, decision, predicted confidence,
outcome, one-line lesson. Raise confidence in approaches that worked; retire
any approach that failed twice.

## Reference

**Escalation.** Ask the user's approval for money and irreversible external
effects. Ask the user directly when objectives conflict, or the domain is
unfamiliar, high-stakes, and evidence is thin. Spawn a child for an
independent bounded subtask with clear input and output. Decide everything
else yourself, inside the delegated scope.

**Course correction.** No progress after 3 consecutive rounds → shrink the
next increment or change approach. Confidence below 2/5 on an expensive
option → buy information first with a cheap probe (a tracer bullet: the
thinnest end-to-end slice that tests the risky assumption). Two failures of
the same approach → retire it and promote the runner-up.

**Calibration.** Every 10 decisions, compare predicted confidence with
outcome rate in `DECISIONS.md`. Predictions that match outcomes are the
target; adjust your confidence estimates, not the record.

**Budget.** Plan spend by phase: reserve for verification and for the
approval-wait rounds. When remaining budget can't cover the next phase, say
so before it runs out.
