# 04 — Real-money approval gate

Type: task
Status: open

## Question

The standing guardrail: every real-money action pauses for explicit user
approval. What is the protocol shape? Constraint from AGENTS.md: one built-in
tool (`ipython`) — so the agent expresses "I need approval for X" through the
kernel (`host_request`), the host flips the goal into a waiting-for-approval
state, the user approves/denies via the GUI/API, and the outcome returns to
the model. The transcript must record the request and the decision
(append-only). Record the exact protocol (request kind, payload, state
transition, transcript entries) as this ticket's answer.
