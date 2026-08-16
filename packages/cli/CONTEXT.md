# CLI

The `deep-agent` command surface: starts the host, manages the daemon, and manages skills. Thin — all logic lives in the host.

## Language

**Serve**:
Run the host + web UI in the foreground; `--daemon` respawns the same command detached, logging to `<dataDir>/deep-agent.log`.
_Avoid_: Start, run

**Pidfile**:
`<dataDir>/deep-agent.pid`, written by the daemon and read by `status`/`stop`; removed when the process is confirmed gone.
_Avoid_: Lock file

**Status / stop**:
Commands that read the pidfile: `status` checks liveness plus the `/api/health` endpoint; `stop` sends SIGTERM and waits for exit.
_Avoid_: Health check (that is the HTTP route status calls)

**Skills subcommand**:
`skills list` and `skills install <dir>`; registry operations surfaced without starting the server.
_Avoid_: Add skill, plugin command

**Config precedence**:
Defaults → config file (`DEEP_AGENT_CONFIG`, else `~/.config/deep-agent/config.json`) → env vars → CLI flags; later wins.
_Avoid_: Settings resolution
