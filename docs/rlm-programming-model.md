# The RLM Programming Model

The model inside deep-agent follows the recursive-language-model (RLM) model of
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent): the host keeps
state, and the model works **programmatically** in a persistent kernel.

## Core invariant: execution is programmatic

The agent has exactly **one built-in tool** — `ipython`. Reading and editing
files, running project commands, transforming results, and delegating work all
begin from the persistent kernel; there are no separate file or shell tools.

```python
from pathlib import Path
config_files = [p for p in Path(".").rglob("*.toml") if p.stat().st_size > 10_000]
```

Shell work uses cell and line magics:

```bash
%%bash
pnpm run check
```

```python
!ls -la
%cd subproject
```

Python state — variables, imports, functions, the working directory — survives
across tool calls and turns. End a cell with an expression to inspect it; the
repr comes back as the cell's result. The last expression is also honored inside
top-level-await cells.

## Subagents are native calls

The callable `rlm` object is preloaded in the kernel. Spawn a child; the call
returns an admission handle immediately and never waits for the child's answer:

```python
handle = await rlm("Review the authentication flow for security issues", name="auth-reviewer")
# handle: {"child_id": ..., "name": "auth-reviewer", "session_dir": ..., "model": ...}
```

Spawn independent children in separate calls, then end your turn:

```python
api_review = await rlm("Review the public API", name="api-reviewer")
test_review = await rlm("Review test coverage", name="test-reviewer")
```

Children are real sessions with their own kernels. They reply with messages,
and you can follow up with a retained child:

```python
children = await rlm.list_subagents()          # [{id, name, status, depth, model}]
await agent_message.send("Also check X", receiver_role="child", receiver_name="api-reviewer")
await rlm.delete_subagent("test-reviewer")
```

A child's answer (or explicit `agent_message`) lands in your transcript as a
message from the child and always wakes a new turn so you can integrate the
result — when a goal is active on auto-continuation that wake counts as a goal
round; otherwise it is a single bounded continuation. Depth is bounded by the
host's `maxDepth`.

## Goals

Create a goal to get autonomous continuation rounds — the host re-enters the
session each round until the objective completes or the round budget runs out:

```python
await rlm.goal.create("Implement the parser and its tests")
status = await rlm.goal.status()
await rlm.goal.complete("parser shipped")
await rlm.goal.block("waiting on the upstream API")
```

A blocked goal stops auto-continuation; the human (or a later turn) re-arms it.

## Skills

A suite of instruction skills ships with the harness (vendored in the repo's
`skills/` directory and seeded into the data dir on first run). The system
prompt lists their metadata; load the full instructions when a task matches:

```python
skills = await rlm.skills.list()          # [{name, description}, ...]
skill = await rlm.skills.load("tdd")      # {name, content} — the full SKILL.md
```

Need a skill that isn't installed? Fetch or write it in the workspace, then
hand it to the host (which validates and copies it — the kernel never writes
outside its workspace):

```python
await rlm.skills.install("downloaded/my-new-skill")
```

## The host bridge

`rlm`, `agent_message`, the goal API, and the skills API are thin wrappers over
typed `host_request` messages. The kernel cell blocks until the TypeScript host
validates the request and replies; a rejected request raises `HostError` in the
cell. This keeps credentials, provider execution, session routing, skills
storage, and safety policy out of Python while keeping the model surface a
plain function call.

## Result shape

Every `ipython` call returns `{stdout, stderr, result_repr, error, duration_ms}`;
`error` carries the exception type, message, and traceback. Output is truncated
(defensively sized) before it reaches the model context; the full cell is
recorded in the session transcript.

## Trust model

The kernel runs model-generated Python and shell with the host's OS
permissions. It is a durable control environment, **not a security sandbox**.
Review code before running it against anything you care about, and use an
external sandbox for untrusted repositories.
