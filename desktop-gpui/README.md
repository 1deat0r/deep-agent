# desktop-gpui — Deep Agent desktop client on GPUI

A native, GPU-accelerated desktop client for the deep-agent host, styled after
the DeepSeek Harness web UI (dark bluish neutrals, DeepSeek-blue accent) and
branded Deep Agent. Built on [GPUI](https://www.gpui.rs/), Zed's UI framework.

## Run

```sh
# host must be running (pnpm dev, or an existing serve at 127.0.0.1:3824)
cd desktop-gpui
cargo run            # debug (set DEEP_AGENT_URL to point elsewhere)
cargo run --release  # production
```

## Architecture

- `src/api.rs` — typed client for the host's HTTP+SSE API (ureq, blocking
  calls run on GPUI's background executor).
- `src/state.rs` — single `AppState` entity: sessions, selected detail,
  streaming draft, usage totals. Background tasks update it through owned
  `AsyncApp` handles; SSE events flow in over a `smol` channel.
- `src/theme.rs` — DeepSeek-Harness design tokens (design-platform.css),
  rebranded for Deep Agent.
- `src/ui/` — sidebar (wordmark, sessions), chat view (bubbles, cells,
  streaming), composer input card (model/reasoning cycle pills, token + cache
  readout, send/continue/interrupt).

## GPUI 0.2.2 notes (learned the hard way)

- `App::spawn` futures run on the **foreground** executor; blocking I/O must
  go through `cx.background_executor().spawn(...)`.
- `AsyncApp` is not `Send` — keep it on the UI thread; pass events across
  threads with a `smol` channel and drain on the foreground.
- `.id(...)`, `.hover(...)`, `.active(...)` wrap the element in
  `Stateful<Div>`; the fluent `on_click`/`overflow_*`/`scroll_*` live on the
  `Stateful` side. Call `.id(...)` first in every interactive chain and end
  with `.hover(...)`.
- `Context::spawn` closures capture `cx` by reference — grab
  `cx.to_async()` (owned, cloneable) before the `async move` block.
