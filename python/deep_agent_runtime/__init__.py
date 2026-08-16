"""deep_agent_runtime: the persistent Python control environment for the deep-agent RLM.

This package is pure-stdlib by design: the model-facing programming surface is a
single long-lived Python kernel (not IPython/Jupyter), speaking JSON-lines over
stdin/stdout with the TypeScript host.

The kernel preloads a small ``rlm`` bridge so model code can spawn child agents,
message the parent, and reach host-owned state (goals, scheduling) as plain
function calls.
"""

__version__ = "0.1.0"
