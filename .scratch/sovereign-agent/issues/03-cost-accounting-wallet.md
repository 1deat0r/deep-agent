# 03 — Cost accounting and wallet: how does the agent pay its way?

Type: grilling
Status: open

## Question

The user pays the API bill; the harness must at minimum *know what it costs*
and stop before it overruns a budget. Decisions needed: usage source (provider
usage fields vs `estimateTokens` fallback), where rates live, where the
running spend persists, and what happens when the budget hits zero.
