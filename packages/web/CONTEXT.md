# Web

The React GUI. It holds no authoritative state: it renders the snapshot endpoints and applies the SSE stream on top.

## Language

**Snapshot**:
The REST payloads fetched on selection (`/api/sessions/:id`, `/api/config`, `/api/models`, `/api/skills`) — the GUI's starting state before live events arrive.
_Avoid_: Fetch, initial load

**Stream application**:
Consuming SSE events (`message_delta`, `cell_start`, `cell_result`, ...) to update the view live: deltas append to the streaming bubble, completed messages and cells land in the transcript, status dots and children lists update.
_Avoid_: Live update, sync

**Reconcile**:
Re-fetching the session snapshot after a turn ends (or the stream reconnects) to repair anything events missed — e.g. messages appended without an event.
_Avoid_: Resync, refresh (Refresh is the sidebar button)

**Streaming bubble**:
The in-progress assistant message rendered from `message_delta` events before its `message_complete` finalizes it into the transcript.
_Avoid_: Typing indicator, pending message

**Console REPL**:
The Console tab's manual executor: code typed by the user runs through `/api/sessions/:id/kernel`, results render as cell blocks.
_Avoid_: Terminal, shell

**Toast**:
A transient error/status banner.
_Avoid_: Alert, snackbar
