# deep-agent

**A DeepSeek-Harness-style agent harness with a prime-agent-style RLM core.**

deep-agent is a self-hosted harness for coding and research agents. The surface is
familiar from harnesses like DeepSeek Harness — web GUI, sessions, subagents, goals,
a kernel console — but the agent core follows the **RLM programming model** from
[Prime Intellect's prime-agent](https://github.com/PrimeIntellect-ai/prime-agent):
the model gets exactly **one built-in tool** (`ipython`) and composes every
capability as code in a persistent Python kernel.

```
Web GUI (React) ──▶ TypeScript host (RLM loop, sessions, children, goals, skills)
                        │  spawn
                        ▼
                 persistent Python kernel (one ipython tool)
                        │  rlm(...) / agent_message / goals / skills
                        ▼
                 host bridge (validated, host-owned state)
```

## Quickstart

```bash
pnpm install
pnpm build                        # build provider, kernel, host, cli, web
pnpm test:python                  # kernel tests
pnpm test                         # TS tests

# mock provider (no API key, exercise the whole harness offline):
node packages/cli/dist/bin/deep-agent.js serve --provider mock

# real provider (DeepSeek API, or any OpenAI-compatible endpoint):
DEEP_AGENT_API_KEY=sk-... node packages/cli/dist/bin/deep-agent.js serve
```

Open the printed URL (default `http://127.0.0.1:3824`) — the host serves the
built web GUI from `packages/web/dist` (`pnpm dev:web` runs the Vite dev server
on 5173 instead, which talks to the host on 127.0.0.1:3824).

## How the agent works

Every agent session owns one persistent Python kernel. The model's only tool call
is `ipython` — reading files, running project commands, transforming data, and
spawning children are all just code:

```python
files = [p for p in Path(".").rglob("*.py") if "test" in p.name]
```

```python
handle = await rlm("Review the auth flow for security issues", name="auth-reviewer")
```

```python
await rlm.goal.create("Implement the parser and its tests")
```

## Skills: sovereign by default

deep-agent ships with the **Matt Pocock skill suite** vendored in `skills/`
(37 skills: TDD, code review, domain modeling, diagnosis, triage, wayfinding,
writing, grilling, and the rest). On first run the host seeds them into
`<dataDir>/skills`, lists their metadata in the agent's system prompt, and the
model loads them on demand — `await rlm.skills.load("tdd")` — or installs new
ones from its workspace: `await rlm.skills.install("path/to/skill")`.

A fresh clone is fully self-contained: `pnpm build && node
packages/cli/dist/bin/deep-agent.js serve --provider mock` runs the whole
harness offline, skills included. Manage skills from the CLI too:

```bash
node packages/cli/dist/bin/deep-agent.js skills list
node packages/cli/dist/bin/deep-agent.js skills install <dir>
```

Full model: [docs/rlm-programming-model.md](docs/rlm-programming-model.md).

## Repository map

| Path | What it is |
| --- | --- |
| `packages/provider/` | `@deep-agent/provider` — OpenAI-compatible streaming client + scripted mock |
| `packages/kernel/` | `@deep-agent/kernel` — TS manager for the kernel subprocess |
| `packages/host/` | `@deep-agent/host` — RLM loop, sessions, children, goals, skills, HTTP+SSE server |
| `packages/web/` | `@deep-agent/web` — the web GUI (React + Vite) |
| `packages/cli/` | `@deep-agent/cli` — the `deep-agent serve` / `skills` commands |
| `python/deep_agent_runtime/` | The kernel: pure-stdlib persistent Python with the `rlm` bridge |
| `skills/` | Vendored Matt Pocock skill suite, seeded into the data dir |
| `docs/` | [Architecture](docs/architecture.md), the [RLM model](docs/rlm-programming-model.md), and the agent tooling config in `docs/agents/` |

Architecture and data flow: [docs/architecture.md](docs/architecture.md).

## Configuration

`deep-agent serve --config config.example.json`, flags, and env vars
(`DEEP_AGENT_API_KEY`, `DEEP_AGENT_MODEL`, `DEEP_AGENT_BASE_URL`, ...). All
options are listed in `deep-agent serve --help` and [config.example.json](config.example.json).

## Status

Functional MVP: RLM loop, persistent kernel with magics and top-level `await`,
`rlm()` subagents with depth limits and message routing, goals with autonomous
continuation rounds, session persistence, SSE event stream, web GUI, and a
scripted mock provider so the whole loop runs without an API key. See
[ROADMAP.md](ROADMAP.md) for what is deliberately missing (kernel restart on
crash, compaction, sandboxing, desktop shell).

## License

MIT
