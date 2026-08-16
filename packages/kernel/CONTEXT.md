# Kernel

The persistent Python process that is the model's only execution surface, and the TypeScript manager that owns its lifecycle.

## Language

**Cell**:
One block of Python (possibly with magic syntax) executed in the kernel's durable namespace; the unit of kernel work. A cell produces stdout, stderr, a result repr, and optionally an error with a traceback.
_Avoid_: Snippet, command, job

**Namespace**:
The kernel's Python globals — variables, imports, functions — that persist across cells and turns until the kernel restarts.
_Avoid_: State, environment

**Host request**:
A typed capability request the kernel sends while a cell blocks (spawn a child, list/load/install skills, goals, messaging). The host validates it and replies; rejection raises `HostError` in the cell.
_Avoid_: RPC, callback

**Host response**:
The host's reply to a host request (payload or error), consumed by the bridge.
_Avoid_: Reply, ack

**Bridge**:
The kernel-side object that serializes host requests and synchronously waits for their responses; the plumbing behind `rlm`, `agent_message`, and `rlm.skills`.
_Avoid_: Connector, channel

**Magic**:
Cell syntax that is not Python: `%%bash` (whole-cell shell), `!command` (line shell), `%cd` (working directory change).
_Avoid_: Shell escape, bang command

**Interrupt**:
`SIGUSR1` delivered to the kernel process; a handler raises inside the running cell so it unwinds with `interrupted by host` while the namespace survives.
_Avoid_: Cancel, kill

**Restart**:
Respawn of an unexpectedly-exited kernel, on demand at the next cell, bounded by `maxKernelRestarts`; the previous namespace is lost and the host says so.
_Avoid_: Reboot, reconnect

**Exec**:
A single cell round trip over the wire (`exec` in, `result` out), tracked by id.
_Avoid_: Run, call
