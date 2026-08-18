# 01: V1 gaps to close

Status: in-progress (dogfood suite landed; see desktop-gpui/src/dogfood.rs)

Verified by the dogfood suite: 11 tests — pure helpers, the real HTTP/SSE
client against a canned server (including `max` reasoning roundtrip and the
camelCase SSE fix it caught), AppState loads, full turn event lifecycle, and
real simulated clicks + keystrokes through the composer. Visual rendering
verified by OCR + pixel forensics against theme tokens.

- [ ] Dropdown popovers for model/reasoning (replace cycle pills with
      deferred absolute menus + outside-click dismissal).
- [ ] Caret movement (arrows, home/end), selection, IME in the composer input.
- [ ] Markdown rendering in assistant bubbles.
- [ ] Right panel: session meta, goal state, children.
- [ ] Wallet budget display + top-up; settings surface.
- [ ] Light theme (harness ships both).
