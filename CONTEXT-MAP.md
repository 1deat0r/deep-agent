# CONTEXT-MAP

deep-agent is a multi-context repo. Each context owns its glossary; read the
ones relevant to the area you're about to work in. Context files are created
lazily by the `/domain-modeling` skill — absent ones are simply not yet written.

| Context | CONTEXT.md | Area |
| --- | --- | --- |
| provider | `packages/provider/CONTEXT.md` | OpenAI-compatible streaming client, chunks, collection, scripted mock |
| kernel | `packages/kernel/CONTEXT.md` | KernelManager subprocess, JSON-lines protocol, host requests |
| host | `packages/host/CONTEXT.md` | RLM turn loop, sessions, children, goals, skills, events, persistence |
| web | `packages/web/CONTEXT.md` | GUI state model, SSE application, tabs |
| cli | `packages/cli/CONTEXT.md` | `deep-agent serve` / `skills` command surface |
| python-runtime | `python/CONTEXT.md` | deep_agent_runtime kernel, magics, rlm bridge, namespace |
