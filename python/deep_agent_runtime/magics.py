"""Cell magics: minimal IPython-style conveniences supported by the kernel.

- ``%%bash`` / ``%%sh`` cell magic: run the whole cell body through a shell.
- ``!command`` line magic: run a single shell line and show its output.
- ``%cd <path>`` line magic: change the kernel's working directory.

Everything else is executed as ordinary Python in the persistent namespace.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

_CELL_MAGIC = re.compile(r"^\s*%%(bash|sh)\b(?P<rest>[^\n]*)\n(?P<body>.*)$", re.S)
_CD_MAGIC = re.compile(r"^\s*%cd\s+(?P<path>.+?)\s*$")
_BANG_MAGIC = re.compile(r"^\s*!(?P<cmd>.*?)\s*$")


class ShellCell:
    def __init__(self, shell: str, body: str):
        self.shell = shell
        self.body = body


def transform_cell(code: str) -> "str | ShellCell":
    """Return either transformed Python source or a ShellCell to run directly."""
    stripped = code.strip()
    if not stripped:
        return ""
    match = _CELL_MAGIC.match(code)
    if match:
        return ShellCell(match.group(1), match.group("body"))
    return _transform_lines(code)


def _transform_lines(code: str) -> str:
    out_lines: list[str] = []
    for line in code.split("\n"):
        cd = _CD_MAGIC.match(line)
        if cd:
            out_lines.append(f"_rlm_cd({cd.group('path')!r})")
            continue
        bang = _BANG_MAGIC.match(line)
        if bang:
            out_lines.append(f"_rlm_shell({bang.group('cmd')!r})")
            continue
        out_lines.append(line)
    return "\n".join(out_lines)


def run_shell(shell: str, body: str, cwd: str) -> tuple[str, str, int]:
    """Run a shell cell, returning (stdout, stderr, returncode)."""
    proc = subprocess.run(
        [shell, "-c", body],
        cwd=cwd,
        capture_output=True,
        text=True,
        env=dict(os.environ),
    )
    return proc.stdout, proc.stderr, proc.returncode


def run_line(cmd: str, cwd: str) -> tuple[str, str, int]:
    """Run a single shell line, returning (stdout, stderr, returncode)."""
    proc = subprocess.run(
        cmd,
        shell=True,
        cwd=cwd,
        capture_output=True,
        text=True,
        env=dict(os.environ),
    )
    return proc.stdout, proc.stderr, proc.returncode


def cd(path: str) -> str:
    """Change the kernel's working directory; returns the new cwd."""
    os.chdir(os.path.expanduser(path))
    return os.getcwd()
