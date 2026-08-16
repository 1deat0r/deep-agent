# One built-in tool: a persistent Python kernel

The agent loop exposes exactly one tool (`ipython`) backed by a long-lived,
pure-stdlib Python process we wrote ourselves, rather than a bag of native
file/shell tools or an IPython/Jupyter kernel. We chose this because the RLM
programming model composes every capability as code in a durable namespace;
the alternatives we rejected were many small native tools (more schemas for
the model to juggle, more host code to keep consistent) and Jupyter's kernel
(heavy install, less control over the protocol and magics). Consequence: the
kernel's namespace is invisible to the host, which is why restarts and
compaction explicitly tell the model when the namespace is lost.
