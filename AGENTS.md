# AGENTS.md

## What this repo is

deep-agent: a self-hosted agent harness — web GUI + TypeScript host + one
persistent Python kernel per session as the **only** model-facing tool
(the RLM model). Read [docs/architecture.md](docs/architecture.md) for the data
flow and [docs/rlm-programming-model.md](docs/rlm-programming-model.md) for the
model surface before changing the loop.

## Layout and commands

- Workspace packages: `packages/{provider,kernel,host,web,cli}` (pnpm).
- Kernel runtime: `python/deep_agent_runtime/` — pure stdlib, no install needed.
- Build: `pnpm build` · Typecheck: `pnpm -r typecheck` · TS tests: `pnpm test`
  (vitest, aliases resolve workspace deps to `src/`).
- Python tests: `python3 -m unittest discover python/deep_agent_runtime -v`.
- Run: `node packages/cli/dist/bin/deep-agent.js serve --provider mock`
  (build the CLI first). Web GUI dev server: `pnpm dev:web` (port 5173).

## Hard invariants

1. **One built-in tool.** The agent loop exposes only `ipython`. New model
   capabilities become kernel API (a preloaded object or a host-request kind) —
   never an additional tool schema.
2. **Host-owned state stays in TypeScript.** Child lifecycles, message routing,
   goals, credentials, and provider execution live in `packages/host`; the
   kernel reaches them only through `host_request` messages (see the bridge in
   `python/deep_agent_runtime/rlm.py` and `AgentSession.handleHostRequest`).
3. **The kernel wire must stay clean.** Kernel protocol writes go through
   `sys.__stdout__`, never `print()` — a running cell redirects stdout, and a
   protocol line captured into cell output is a real bug class here.
4. **Transcript is append-only truth.** `transcript.jsonl` is the source for
   rebuilding LLM context on resume; messages and cells both live in it. If you
   add a step in `AgentSession.doRunTurn`, decide where it lands in the
   transcript before implementing.

## Cross-cutting changes checklist

- Changing the kernel protocol: update `python/deep_agent_runtime/kernel.py`,
  the TS `KernelManager`, the in-process Python tests, and
  `packages/kernel/test`.
- Changing the RLM surface (rlm/agent_message/goals): update `rlm.py`, the
  system prompt in `packages/host/src/system-prompt.ts`, and
  `docs/rlm-programming-model.md` together — the prompt is what teaches the
  model the API you ship.
- Changing an API route: update `HostServer`, the TS types in `packages/host/src/types.ts`,
  and the web GUI's `packages/web/src/api.ts` + types in the same change.

## Conventions

- TypeScript: strict + `exactOptionalPropertyTypes`. Options-bag fields are
  required-but-maybe-`undefined` (assigning `undefined` explicitly is idiomatic
  here); optional syntax is for genuinely absent fields.
- Tests are deterministic: LLM behavior is scripted with `MockLlmClient`
  (`packages/provider/src/mock.ts`), using `MockLlmClient.shared` so root and
  child sessions draw from role-scoped queues.
- Pure-stdlib Python in the runtime: no third-party imports in
  `python/deep_agent_runtime/` (the kernel must boot anywhere `python3` exists).

## Skills

- Skills are `SKILL.md` directories under `dataDir/skills`, seeded at host
  startup from the suite vendored in `skills/` (copy-on-missing, never
  overwrite). `packages/host/src/skills.ts` owns seed/list/load/install; the
  kernel reaches skills only through `skills_list` / `skills_load` /
  `skills_install` host requests (`rlm.skills.*`).
- The system prompt carries the skill catalog (name + description only); full
  content loads on demand via `rlm.skills.load(name)`. When you add or rename a
  skill's description in `skills/`, the prompt changes with it — no code edit.
- Installing a skill is a host-side copy: relative paths resolve against the
  session workspace, names must match `^[a-z0-9][a-z0-9-]*$` (case-insensitive,
  no traversal), and the source must contain `SKILL.md`.

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature-slug>/`.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map to themselves (`needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `CONTEXT-MAP.md` points at one `CONTEXT.md` per package (and
`python/`), created lazily by `/domain-modeling`; system-wide ADRs live in
`docs/adr/`. See `docs/agents/domain.md`.
