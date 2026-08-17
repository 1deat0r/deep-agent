# 03: Host usage on transcript entries

Status: resolved

Assistant message entries (and compaction entries) carry optional `usage` with
the normalized cache fields; `message_complete` events carry it too.
`SessionStore.messagesFrom` strips `usage` so it never round-trips into LLM
context. Test seam: MockLlmClient script with a usage-bearing done chunk ->
`session.runTurn` -> transcript entry + wallet charge use the reported numbers.
