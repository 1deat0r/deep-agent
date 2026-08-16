# 02 — Host lifecycle: embed in-process or spawn the CLI?

Type: prototype
Status: open
Blocked by: 01

## Question

Should the desktop app embed the deep-agent host in-process (create HostServer
directly in the Electron main, per the CLI's own thinness) or spawn
`deep-agent serve --daemon` as a child? Build a rough artifact to react to: a
minimal main process that starts the host embedded and loads the built GUI, with
single-instance lock and a tray quit. Does this shape feel right?
