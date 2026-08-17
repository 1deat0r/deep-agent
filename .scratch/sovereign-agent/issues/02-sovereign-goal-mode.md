# 02 — Sovereign goal mode: what does "takes charge" mean in the loop?

Type: grilling
Status: resolved

## Question

Today a goal pauses when a direct user message interrupts the loop (resumed
via /continue). Sovereign mode must keep the agent working without human
approval to *decide its work* — while the user stays able to stop it and
steer. Decisions needed: how user messages interact with a running sovereign
goal, whether it re-enters on its own schedule (heartbeat), and what stops it
other than the round cap.

## Answer

Resolved 2026-08-17; the user confirmed shared understanding.

- **Scope**: sovereignty is a **per-goal flag** — `rlm.goals.create` gains
  `sovereign: true`. Normal chats stay interactive; sovereign goals run the
  semantics below. Both can run at once.
- **User messages**: a sovereign goal **never pauses** on a direct user
  message. The message is appended to the transcript and answered by the model
  at the next round boundary. `/interrupt` (and the interrupt API) always
  stops it instantly — the kill switch is never negotiable.
- **Self-scheduling**: when the goal has no pending wake, the host re-enters
  it after a configurable idle interval (`heartbeatMs`, default 300000 = 5
  min). Heartbeat rounds are subject to the wallet (ticket 03) like any other
  round.
- **Stops**: round cap (`maxAutoRounds` per round sequence), budget zero
  (ticket 03), an approval wait (ticket 04), interrupt, or completion.
