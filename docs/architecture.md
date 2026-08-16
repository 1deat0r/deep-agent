# Architecture

One sentence: **a TypeScript host owns state; a persistent Python kernel is the
only model-facing execution surface.**

## Components

```
┌─────────────────────────────────────────────────────────────────────┐
│ web GUI (packages/web, React)                                        │
│   fetch/SSE over the REST API only; holds no authoritative state     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTP + SSE
┌───────────────────────────────▼─────────────────────────────────────┐
│ host (packages/host)                                                 │
│  AgentManager  ── sessions map, spawn children, route messages        │
│  AgentSession  ── RLM turn loop, transcript, goal, kernel handle      │
│  SessionStore  ── meta.json + transcript.jsonl per session dir        │
│  EventBus      ── typed events + per-session replay buffer            │
│  HostServer    ── REST routes + SSE + static web dist                 │
└───────────────┬─────────────────────────────────────────────────────┘
                │ spawn, JSON-lines over stdin/stdout
┌───────────────▼─────────────────────────────────────────────────────┐
│ kernel (python/deep_agent_runtime, pure stdlib)                       │
│  persistent namespace, cell magics, top-level await                   │
│  rlm bridge ── typed host_request messages while a cell blocks        │
└─────────────────────────────────────────────────────────────────────┘
```

## The RLM turn loop (AgentSession.doRunTurn)

1. Append the user message to the transcript.
2. Call the provider with one tool schema: `ipython`.
3. Assistant emits tool calls → execute each through the session's
   `KernelManager` → the tool result (stdout/stderr/result/error, truncated)
   goes back as a `tool` message; the full cell is recorded in the transcript
   and emitted as a `cell_result` event.
4. No tool calls → the assistant message is the turn's answer.
5. If the session has an active goal and `autoContinue`, schedule a bounded
   continuation turn (250 ms later, one round per turn, capped by
   `maxAutoRounds`, then the goal is marked `blocked`).

Turns serialize through a promise chain per session, so child replies and goal
continuations queue behind an in-flight turn instead of racing it.

## Children

`await rlm(prompt, name="...")` inside a cell sends a `spawn_child` host
request; the cell blocks until the host replies with the admission handle. The
host validates depth (`maxDepth`), creates a child session with its own kernel,
and runs the child's first turn in the background. Child completion (or an
explicit `agent_message`) appends a synthetic message to the parent transcript
and wakes a parent turn — counted as a goal round when a goal is active,
otherwise a single bounded continuation. Children reach the parent with
`await agent_message.send(msg, receiver_role="parent")`.

## Kernel protocol

One JSON object per line, both directions (see `python/deep_agent_runtime/kernel.py`):

- host → kernel: `{"type": "exec", "id", "code"}`, `{"type": "host_response", "request_id", "payload" | "error"}`, `{"type": "shutdown"}`
- kernel → host: `{"type": "ready"}`, `{"type": "result", "id", ...}`, `{"type": "host_request", "request_id", "request"}`

The kernel blocks during `exec`; while a cell awaits a bridge call, the bridge
reads stdin itself. Protocol writes bypass any active stdout redirect so cell
output can never corrupt the wire.

## Kernel resilience

A cell that kills the kernel process (e.g. `os._exit`) fails that cell only —
the turn survives, the model is told the kernel will restart on its next call,
and the next `ipython` exec respawns the process (up to `maxKernelRestarts`
per session). Each respawn emits `kernel_restarted` and appends a system
message to the transcript warning that all Python state was lost, so the model
re-establishes what the task needs instead of silently trusting stale state.

A runaway cell can be stopped mid-flight: the host sends `SIGUSR1` to the
kernel process (POSIX only), the kernel's handler raises inside the cell, and
the cell reports `interrupted by host` while the kernel — and its Python
state — survives. `POST /api/sessions/:id/interrupt` aborts the provider call
and interrupts an executing cell; the turn ends as `(interrupted by user)`.
Cells announce themselves with a `cell_start` event before executing.

## Persistence

`dataDir/sessions/<id>/`:

- `meta.json` — SessionMeta (id, role, parent, depth, goal, status, ...)
- `transcript.jsonl` — messages and cells, append-only; the LLM context is
  rebuilt from it on resume
- `workspace/` — the kernel's working directory (project files land here)

Restarting the host reloads every session as `idle` with its transcript;
kernels are respawned lazily on first tool use (Python state does not survive a
host restart in this MVP).

## Skills

`SkillsRegistry` (`packages/host/src/skills.ts`) owns `dataDir/skills`, a
directory of Agent-Skills packages (one `SKILL.md` per subdirectory):

- **Seed** — at host startup, skills vendored in the repo's `skills/` dir are
  copied into `dataDir/skills` when missing (copy-on-missing; user-installed
  copies are never overwritten). The suite ships with the repo, so a fresh
  clone is sovereign — no external registry.
- **List/load** — `skills_list` returns frontmatter metadata (name +
  description); `skills_load` returns the full `SKILL.md` (256 KB cap).
- **Install** — `skills_install` copies a directory containing `SKILL.md` into
  the registry. Relative paths resolve against the calling session's workspace;
  names must match `[a-z0-9-]+`; duplicates and traversal attempts are rejected.
- The system prompt carries the catalog (metadata only, descriptions truncated)
  and instructs the model to `await rlm.skills.load(name)` before acting on a
  matching task.

## Compaction

When the messages that will be sent to the provider exceed `compactAtTokens`
(counted with a real BPE tokenizer — js-tiktoken's cl100k_base, falling back to
a chars/4 estimator), the session asks the model to summarize everything before
a recent keep-window (`compactKeepTokens`) and appends a **compaction entry** to
the transcript. The entry is append-only and carries `from` — the transcript
index of the first kept message — so the LLM context rebuilds deterministically
on resume: `[system prompt, summary-as-system-message, ...messages from \`from\`
onward]`. Tool messages stay paired with the assistant call that issued them.
Only post-marker messages are measured on later turns, so already-compacted
history is never re-summarized; if summarization fails, the turn proceeds with
the full context. `contextWindowTokens` (default 60k for deepseek-chat's 64k
window) is the budgeting reference the thresholds derive from. History in
`transcript.jsonl` is never rewritten — the GUI and the session detail endpoint
keep the complete record.

## Events and SSE

`EventBus` emits typed `HostEvent`s (turn lifecycle, deltas, cells, children,
goals, errors, deletions) and keeps a 500-event replay buffer per session. `GET
/api/sessions/:id/events` replays the buffer, then streams live events; the web
GUI rebuilds its view from the snapshot endpoint plus this stream.

## Deletion

`DELETE /api/sessions/:id` removes the session, its children (cascade), and
their on-disk directories; returns 404 for unknown ids and emits
`session_deleted` for every removed session. Deleted sessions stop writing:
`append`/`touch` are no-ops once a session is disposed, so a queued turn can
never recreate a deleted directory.

## Trust model

The kernel runs model-generated Python with the host's OS permissions. It is a
durable control environment, **not a sandbox** — same trade as prime-agent.
Anything host-owned (spawns, routing, goals, provider execution) goes through
validated host requests; the kernel never sees credentials.
