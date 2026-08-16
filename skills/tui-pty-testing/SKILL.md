---
name: tui-pty-testing
description: Verify interactive terminal/TUI behavior with a real PTY - drive the actual binary in a tmux session, send keystrokes, and read back the decoded screen. Use when a task involves testing an interactive CLI or TUI (agent chat input, slash-command menus, autocomplete popups, full-screen selectors), or whenever about to claim something "can't be tested headlessly" for a terminal thing - check for PTY tooling (tmux, script) FIRST.
---

# TUI / interactive-CLI PTY testing (tmux probe)

## When to use
- Any task that verifies an interactive terminal UI: agent chat input, slash-command
  menus, autocomplete popups, full-screen TUI overlays, interactive selectors.
- ANY time you are about to claim "this can't be tested headlessly" for a
  terminal thing. Check for PTY tooling FIRST: `command -v tmux script`.

## Why
The agent's shell stdin is a pipe, not a TTY. Interactive TUIs (raw mode,
alternate screen, keypress reading) need a real terminal. tmux provides a real
PTY, lets us send keystrokes (`send-keys`) and read back the DECODED screen
(`capture-pane -p`). This is the standard way to test TUIs. It has caught real
bugs that registration/unit-level checks missed (e.g. a slash command that
rendered usage instead of its list view).

## Quick start
```bash
# 1. tooling check (both must exist; on this box they do)
command -v tmux script

# 2. isolated probe: scratch home so the probe never touches real state
PROBE=/tmp/axiom-probe-home; rm -rf "$PROBE"; mkdir -p "$PROBE"

# 3. start the real binary in a tmux pane (real PTY, 120x40)
tmux kill-session -t probe 2>/dev/null
tmux new-session -d -s probe -x 120 -y 40
tmux send-keys -t probe "cd /path/to/repo && AXIOM_HOME=$PROBE ~/.local/bin/axiom --offline" Enter

# 4. wait for boot, inspect the screen
sleep 6
tmux capture-pane -p -t probe | tail -20          # human-readable screen
tmux capture-pane -p -t probe | grep -E "expected|labels"   # assert content

# 5. drive it: type, wait, capture
tmux send-keys -t probe "/pro"
sleep 1.5
tmux capture-pane -p -t probe | tail -14          # expect the popup rows

# 6. cleanup
tmux kill-session -t probe 2>/dev/null; rm -rf "$PROBE"
```

## Pitfalls (learned the hard way)
- **Two Enters**: with an autocomplete popup open, the first Enter ACCEPTS the
  highlighted completion (closes the popup); the second Enter submits the line.
  To run a completed command: Enter, brief pause, Enter.
- **Escape clears the input line**; use it before typing a fresh command.
- **Popup navigation keys can leak into the input** (e.g. sending `j` while a
  popup is open may type `j` instead of moving selection). For deterministic
  flows, type the FULL command name instead of navigating popups.
- **tmux extended-keys warning** on Enter (shown once at session start) is
  harmless for plain ASCII typing.
- **Boot time**: the axiom TUI takes ~5-6s to reach its input prompt
  (`>  Try "explain how @<filepath> works"`); wait before sending keys.
- **Always use a scratch AXIOM_HOME** for probes. Never run mutating commands
  (create/rm) against a real home.
- **`--offline`** avoids startup network operations in the sandbox.
- **tmux screen != user's terminal**: colors, fonts, sizes, latency differ.
  PTY proof = flow works. Pixel/visual judgments still need a human.
- **Token burn check**: the status line shows a token counter; a local command
  should keep it at 0 (0%) — proof it never reached the model.

## When PTY is NOT enough
- Real network/auth flows (needs keys/endpoints).
- Visual design judgment (colors, layout aesthetics).
- Non-terminal surfaces (GUI, browser, phone).
Unit tests remain the base layer; PTY probe is the integration/UX layer.

## Script
A wrapper `tui-probe.sh` lives in this skill directory:
`start <session> <cwd> <command>` / `keys <session> "<keys>"` / `shot <session> [tail-lines]` / `stop <session>`.
Use it to keep the first-resort cost near zero.
