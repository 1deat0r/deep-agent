# Provider

Talks to OpenAI-compatible chat-completions endpoints (DeepSeek, Ollama, ...) over HTTP with streaming, and provides deterministic scripted stand-ins for tests and offline demos.

## Language

**Chunk**:
One event in a streaming response (`delta`, `tool_call_delta`, `done`, `error`). The client yields these; consumers assemble them.
_Avoid_: Token, piece, fragment

**Tool-call delta**:
An incremental fragment of a function call the model is emitting (id/name/arguments arrive piecewise and must be concatenated by index).
_Avoid_: Partial call, call fragment

**Collected response**:
A fully assembled assistant message (content plus complete tool calls) built by consuming a stream to its first `done`.
_Avoid_: Completion, assembled output

**Scripted mock**:
A `MockLlmClient` that replays a queue of prebuilt chunk scripts, one per call, recording snapshots of the inputs it received. Shared-mode mocks draw from one queue so root and child sessions can be scripted deterministically.
_Avoid_: Fake provider, stub LLM

**Echo client**:
The offline fallback provider (`mock` profile) that answers with a canned text echoing the last user message.
_Avoid_: Mock provider (it is the `mock` profile, but it is not the scripted mock)

**Model list**:
The ids returned by the endpoint's `/models` route, used to populate the GUI's per-session model picker.
