# Host

The TypeScript core: the RLM turn loop, sessions, children, goals, skills, persistence, and the HTTP/SSE server. All authoritative state lives here, never in the kernel.

## Language

**Session**:
One agent conversation: a transcript, a goal, a kernel, children, and a model. The unit of state that persists to disk and resumes across restarts.
_Avoid_: Agent, conversation, chat

**Turn**:
One pass of the loop inside a session: a user/system message in, assistant messages and cells until a final answer (or an interrupt, error, or the iteration cap).
_Avoid_: Round (see Goal round), run, step

**Transcript**:
The append-only record of a session: messages, cells, and compaction markers. It is the single source of truth; the LLM context is rebuilt from it.
_Avoid_: History (it is the history, but "history" as a file concept), log

**Cell entry**:
The transcript's record of one executed cell (code, outputs, error, duration) — distinct from the tool message the model sees.
_Avoid_: Cell result, cell log

**Goal**:
A long-running objective with rounds; statuses `active`, `completed`, `blocked`, `paused` (paused when a direct user message interrupts the loop; resumed via /continue). When active with auto-continuation on, the host re-enters the session each round until completion or the round budget.
_Avoid_: Task, mission

**Goal round**:
One auto-continuation turn counted against the goal's `maxRounds`. Child wakes count as rounds only while a goal is active; direct user messages pause the loop.
_Avoid_: Iteration, cycle

**Child (subagent)**:
A session spawned from inside a cell via `rlm(...)` with its own kernel and model (inherited from the parent). Children reply as messages; every reply wakes the parent.
_Avoid_: Worker (it is a worker, but the canonical term is child), sub-session

**Wake**:
A parent turn scheduled when a child replies or a goal round is due. Bounded: one wake per reply.
_Avoid_: Notify, trigger

**Compaction marker**:
A transcript entry holding a summary plus `from`, the transcript index of the first kept message. Context rebuilds as `[system, summary, messages from \`from\`]`; markers are append-only and never rewritten.
_Avoid_: Summary checkpoint (it carries a summary, but the entry is the marker), cut point

**Event**:
A typed, observable fact the host emits (turn lifecycle, cell start/result, deltas, children, goals, deletions, kernel restarts). SSE carries them to the GUI, with a bounded per-session replay buffer.
_Avoid_: Message (events are not chat messages), notification

**Skill**:
A vendored or installed `SKILL.md` directory. Instruction skills load on demand; Python-backed skills also ship an importable package whose dir is on the kernel's `sys.path`.
_Avoid_: Plugin, capability

**Seed**:
Copy-on-missing of the bundled skill suite into `dataDir/skills` at host start; user-installed copies are never overwritten.
_Avoid_: Bootstrap, sync

**Workspace**:
The session's working directory (`<sessionDir>/workspace`); the kernel's cwd, where project files live.
_Avoid_: Project dir, sandbox (it is not sandboxed)

**Provider client**:
A session's LLM client, built per model from the factory — the only way the host talks to a model.
_Avoid_: Connection, backend
