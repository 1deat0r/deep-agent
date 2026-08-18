# GPUI desktop client for deep-agent

Status: in-progress (v1 landed)

Native GPU-accelerated desktop client (desktop-gpui/) using Zed's GPUI
framework, styled after the DeepSeek Harness UI with Deep Agent branding.
Talks to the existing host over HTTP+SSE (no host changes).

V1 (landed): sidebar (sessions, new), chat (bubbles, cells, compaction,
streaming draft), composer input card (model/reasoning cycle pills, token +
cache readout, send/continue/interrupt), dark harness theme.

Known v1 gaps (tracked as issues): textarea has no caret movement or IME;
selectors are cycle pills (no dropdown menus); no markdown rendering in
bubbles; no right panel (goals/children); no wallet/settings surface; light
theme not implemented.
