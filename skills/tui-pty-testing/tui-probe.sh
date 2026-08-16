#!/usr/bin/env bash
# tui-probe: drive an interactive CLI/TUI in a tmux PTY and read the screen.
# usage: tui-probe.sh start <session> <cwd> <command> [env...]
#        tui-probe.sh keys <session> "<keys>"       (e.g. "/pro")
#        tui-probe.sh shot <session> [tail-lines]   (decoded screen)
#        tui-probe.sh stop <session>
set -euo pipefail
action="${1:-}"; session="${2:-probe}"
case "$action" in
  start)
    cwd="${3:?cwd}"; command="${4:?command}"
    tmux kill-session -t "$session" 2>/dev/null || true
    tmux new-session -d -s "$session" -x 120 -y 40
    tmux send-keys -t "$session" "cd '$cwd' && $command" Enter
    ;;
  keys)
    tmux send-keys -t "$session" "${3:?keys}"
    ;;
  shot)
    lines="${3:-20}"
    tmux capture-pane -p -t "$session" | tail -n "$lines"
    ;;
  stop)
    tmux kill-session -t "$session" 2>/dev/null || true
    ;;
  *) echo "usage: tui-probe.sh start|keys|shot|stop"; exit 1;;
esac
