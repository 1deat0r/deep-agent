# Append-only transcript with positional compaction markers

The transcript is never rewritten; when context exceeds the token budget, the
host appends a compaction entry carrying a summary plus `from` — the transcript
index of the first kept message — and rebuilds context as system-prompt +
summary + messages-from-`from`. The natural alternative was trimming or
rewriting the transcript in place, which we rejected because the transcript is
the resumable source of truth and the GUI shows full history. Because markers
append at the tail, they must carry their cut index rather than acting as
an inline boundary; the `from` index stays stable under appends. Tool messages
are kept paired with the assistant call that issued them so the provider
context never becomes malformed.
