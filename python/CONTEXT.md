# Python Runtime

`deep_agent_runtime`: the pure-stdlib persistent kernel process. The only Python in the project; the model's programming surface.

## Language

**Kernel process**:
One long-lived Python interpreter per session, speaking JSON-lines over stdin/stdout with the host.
_Avoid_: Daemon, worker

**Wire**:
The stdout/stderr discipline: protocol lines always go through `sys.__stdout__`, never `print()`, because a running cell redirects stdout.
_Avoid_: Pipe, channel

**rlm object**:
The preloaded callable for subagent control: `rlm(prompt, name=...)` spawns a child, `rlm.list_subagents()`, `rlm.delete_subagent(...)`.
_Avoid_: Agent handle, spawner

**agent_message**:
The preloaded messaging object: `agent_message.send(...)` to the parent or a named child.
_Avoid_: Reply channel, mailbox

**rlm.skills**:
The preloaded skills surface: `list`, `load` (full SKILL.md), `install` (host-validated copy), `import_python` (register a Python-backed package and return its public API).
_Avoid_: Skill loader

**rlm.goal**:
The preloaded goal surface: `create`, `status`, `complete`, `block`.
_Avoid_: Objective API

**Awaitable**:
The kernel's synchronous-bridge wrapper that makes host requests awaitable at top level; a cell blocks until the host replies.
_Avoid_: Future, promise

**HostError**:
Raised in a cell when the host rejects a host request.
_Avoid_: Bridge error

**Top-level await**:
Cells may use `await` at the top level; the cell compiles as a coroutine and runs to completion.
_Avoid_: Async cell

**Cell magics**:
`%%bash`, `!command`, `%cd` — shell conveniences inside cells.
_Avoid_: Shell syntax
