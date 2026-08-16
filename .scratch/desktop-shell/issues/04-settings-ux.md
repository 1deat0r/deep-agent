# 04 — Settings UX: where does the provider config get edited?

Type: grilling
Status: open
Blocked by: 01

## Question

Today provider config (API key, model, base URL) is set in a config file at
server start; the GUI Settings modal is display-only. The desktop app needs a
real settings path. Decision needed: a host config-write endpoint the GUI uses
(with what validation/restart semantics), or keep file editing external and
make the desktop app open/point at it? Depends on the shell choice, since
Electron could also edit the file directly from the main process.
