# Context Map

## Contexts

- [Provider](./packages/provider/CONTEXT.md) — streaming client for OpenAI-compatible endpoints and the scripted stand-ins
- [Kernel](./packages/kernel/CONTEXT.md) — the persistent Python process and its TypeScript manager
- [Host](./packages/host/CONTEXT.md) — the RLM turn loop, sessions, children, goals, skills, persistence, HTTP/SSE
- [Web](./packages/web/CONTEXT.md) — the React GUI (snapshots + SSE application)
- [CLI](./packages/cli/CONTEXT.md) — the `deep-agent` command surface
- [Python Runtime](./python/CONTEXT.md) — `deep_agent_runtime`: the kernel process itself

## Relationships

- **Host → Kernel**: the host spawns and owns the kernel process; host requests flow kernel → host, replies host → kernel.
- **Host → Provider**: sessions build a provider client per model; the host is the only caller.
- **Web → Host**: the GUI consumes the host's REST snapshots and SSE events; it holds no authoritative state.
- **CLI → Host**: the CLI starts/stops the host and delegates skills operations to the registry.
- **Kernel → Host**: children, goals, skills, and messaging all round-trip through the host bridge.
