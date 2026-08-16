# Out-of-band kernel control: SIGUSR1 interrupts, on-demand respawn

Cell interrupts use `SIGUSR1` to the kernel process (a handler raises inside
the running cell) instead of an `interrupt` message on the protocol's stdin.
We rejected the message form because the kernel's bridge reads stdin itself
while a cell awaits a host request, so a second reader would race it; the
signal channel needs no protocol change and unwinds the cell with the
namespace intact. Kernel crashes are likewise handled out-of-band: the failing
cell rejects, and the next cell respawns the process on demand (bounded by
`maxKernelRestarts`) rather than auto-retrying the crashed cell or restarting
eagerly. Consequence: both mechanisms are POSIX-only, like the SIGALRM cell
timeout they sit beside.
