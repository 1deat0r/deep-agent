"""The persistent kernel: protocol loop and Python execution machinery.

Wire protocol (JSON lines, both directions):

    host -> kernel   {"id": "...", "type": "exec", "code": "..."}
                     {"id": "...", "type": "host_response", "request_id": "...", "payload": ..., "error": ...}
                     {"type": "shutdown"}
    kernel -> host   {"type": "ready", ...}
                     {"id": "...", "type": "result", "stdout": ..., "stderr": ..., "result_repr": ..., "error": ..., "duration_ms": ...}
                     {"type": "host_request", "request_id": "...", "request": {"kind": ...}}
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import io
import json
import os
import signal
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Callable, TextIO

from . import magics
from .rlm import _Bridge, build

MAX_STDOUT = 64 * 1024
MAX_STDERR = 64 * 1024
MAX_REPR = 1000
MAX_TRACEBACK = 12 * 1024


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n...[truncated {len(text) - limit} chars]"


class CellInterrupted(Exception):
    """Raised inside a running cell when the host asks the kernel to interrupt."""


class Kernel:
    def __init__(
        self,
        write_line: Callable[[str], None],
        read_line: Callable[[], str],
        *,
        session_id: str,
        session_dir: str,
        workspace_dir: str,
        exec_timeout_ms: int = 0,
        extra_paths: list[str] | None = None,
    ):
        self._write_line = write_line
        self._read_line = read_line
        self._exec_timeout_ms = exec_timeout_ms
        self._bridge = _Bridge(write_line, read_line)
        self._bridge.bind_session(session_id, session_dir, workspace_dir)
        self._workspace_dir = workspace_dir
        Path(workspace_dir).mkdir(parents=True, exist_ok=True)
        os.chdir(workspace_dir)
        for path in extra_paths or []:
            if path not in sys.path:
                sys.path.insert(0, path)
        self._ns: dict[str, Any] = {}
        self._install_interrupt_handler()
        self._load_namespace()

    def _install_interrupt_handler(self) -> None:
        """SIGUSR1 interrupts the running cell (POSIX only, like the timeout).

        The handler raises CellInterrupted; signal handlers run in the main
        thread, which is where cells execute, so the exception unwinds the
        cell and the pending exec reports "interrupted by host".
        """
        if not hasattr(signal, "SIGUSR1"):
            return

        def _on_interrupt(_signum: int, _frame: Any) -> None:
            raise CellInterrupted("interrupted by host")

        self._previous_usr1 = signal.getsignal(signal.SIGUSR1)
        signal.signal(signal.SIGUSR1, _on_interrupt)

    def _load_namespace(self) -> None:
        """Preload the rlm bridge and small conveniences into the namespace."""
        self._ns.update(build(self._bridge))
        self._ns["Path"] = Path
        self._ns["json"] = json
        self._ns["_rlm_cd"] = self._magic_cd
        self._ns["_rlm_shell"] = self._magic_shell

    def _magic_cd(self, path: str) -> str:
        return magics.cd(path)

    def _magic_shell(self, cmd: str) -> None:
        out, err, code = magics.run_line(cmd, os.getcwd())
        if out:
            sys.stdout.write(out)
        if err:
            sys.stderr.write(err)
        if code != 0:
            sys.stderr.write(f"[shell exit code {code}]\n")

    # -- protocol ----------------------------------------------------------

    def run_forever(self) -> None:
        self._write_line(
            json.dumps(
                {
                    "type": "ready",
                    "python_version": sys.version.split()[0],
                    "cwd": os.getcwd(),
                    "workspace_dir": self._workspace_dir,
                }
            )
        )
        while True:
            line = self._read_line()
            if not line:  # EOF: stdin closed
                return
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = msg.get("type")
            if kind == "shutdown":
                return
            if kind == "exec":
                self._handle_exec(msg)
            # host_response lines are consumed by _Bridge.request() during exec.

    def _handle_exec(self, msg: dict[str, Any]) -> None:
        exec_id = msg.get("id")
        code = msg.get("code") or ""
        started = time.monotonic()
        try:
            result = self._execute(code)
            response = {"type": "result", "id": exec_id, **result}
        except Exception as exc:  # defensive: exec errors are normally captured below
            response = {
                "type": "result",
                "id": exec_id,
                "stdout": "",
                "stderr": "",
                "result_repr": None,
                "error": self._format_error(exc),
            }
        response["duration_ms"] = int((time.monotonic() - started) * 1000)
        self._write_line(json.dumps(response, default=str))

    # -- execution ---------------------------------------------------------

    def _execute(self, code: str) -> dict[str, Any]:
        stdout, stderr = io.StringIO(), io.StringIO()
        result_repr: str | None = None
        error: dict[str, Any] | None = None

        transformed = magics.transform_cell(code)
        if isinstance(transformed, magics.ShellCell):
            with self._redirect(stdout, stderr):
                out, err, returncode = magics.run_shell(
                    transformed.shell, transformed.body, os.getcwd()
                )
            stdout.write(out)
            if err:
                stderr.write(err)
            if returncode != 0:
                stderr.write(f"[shell exit code {returncode}]\n")
            return {
                "stdout": _truncate(stdout.getvalue(), MAX_STDOUT),
                "stderr": _truncate(stderr.getvalue(), MAX_STDERR),
                "result_repr": None,
                "error": None,
            }

        try:
            tree = ast.parse(transformed)
        except SyntaxError as exc:
            return {
                "stdout": "",
                "stderr": "",
                "result_repr": None,
                "error": self._format_error(exc),
            }

        try:
            code_obj = compile(tree, "<cell>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        except SyntaxError as exc:
            return {
                "stdout": "",
                "stderr": "",
                "result_repr": None,
                "error": self._format_error(exc),
            }

        # Top-level await produces a coroutine code object. The last expression
        # is handled separately in both cases (IPython-style repr), since
        # exec-mode coroutines have no implicit return value.
        is_coroutine = bool(code_obj.co_flags & inspect.CO_COROUTINE)
        last_expr: ast.expr | None = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = tree.body.pop().value  # type: ignore[assignment]
            try:
                code_obj = compile(
                    tree, "<cell>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
                )
                is_coroutine = bool(code_obj.co_flags & inspect.CO_COROUTINE)
            except SyntaxError as exc:
                return {
                    "stdout": "",
                    "stderr": "",
                    "result_repr": None,
                    "error": self._format_error(exc),
                }

        with self._redirect(stdout, stderr):
            last_value: Any = None
            try:
                def _run() -> None:
                    nonlocal last_value
                    # eval (not exec) so a top-level-await code object's
                    # coroutine comes back to us instead of being discarded.
                    value = eval(code_obj, self._ns)  # noqa: S307
                    if is_coroutine:
                        asyncio.run(value)
                    if last_expr is not None:
                        last_value = eval(
                            compile(
                                ast.Expression(last_expr),
                                "<cell>",
                                "eval",
                                flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT,
                            ),
                            self._ns,
                        )
                        if inspect.iscoroutine(last_value):
                            last_value = asyncio.run(last_value)

                self._run_with_timeout(_run)
            except BaseException as exc:
                error = self._format_error(exc)

        if error is None and last_expr is not None:
            try:
                result_repr = _truncate(repr(last_value), MAX_REPR)
            except BaseException as exc:
                error = self._format_error(exc)

        return {
            "stdout": _truncate(stdout.getvalue(), MAX_STDOUT),
            "stderr": _truncate(stderr.getvalue(), MAX_STDERR),
            "result_repr": result_repr,
            "error": error,
        }

    def _redirect(self, stdout: TextIO, stderr: TextIO):
        from contextlib import redirect_stdout, redirect_stderr

        return _CombinedRedirect(redirect_stdout(stdout), redirect_stderr(stderr))

    def _run_with_timeout(self, thunk: Callable[[], None]) -> None:
        if self._exec_timeout_ms <= 0 or not hasattr(signal, "setitimer"):
            thunk()
            return

        def _alarm(_signum: int, _frame: Any) -> None:
            raise TimeoutError(f"cell exceeded {self._exec_timeout_ms}ms timeout")

        previous = signal.signal(signal.SIGALRM, _alarm)
        signal.setitimer(signal.ITIMER_REAL, self._exec_timeout_ms / 1000.0)
        try:
            thunk()
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)

    def _format_error(self, exc: BaseException) -> dict[str, Any]:
        if isinstance(exc, (SyntaxError, IndentationError)):
            message = f"{exc.__class__.__name__}: {exc.msg} (line {exc.lineno})"
        else:
            message = f"{exc.__class__.__name__}: {exc}"
        return {
            "type": exc.__class__.__name__,
            "message": message,
            "traceback": _truncate(
                "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
                MAX_TRACEBACK,
            ).split("\n"),
        }


class _CombinedRedirect:
    def __init__(self, out: Any, err: Any):
        self._out = out
        self._err = err

    def __enter__(self):
        self._out.__enter__()
        self._err.__enter__()
        return self

    def __exit__(self, *args: Any) -> None:
        self._out.__exit__(*args)
        self._err.__exit__(*args)


def main() -> None:
    """CLI entry point: python3 -m deep_agent_runtime [options]."""
    import argparse

    parser = argparse.ArgumentParser(prog="deep_agent_runtime")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--workspace-dir", required=True)
    parser.add_argument("--exec-timeout-ms", type=int, default=0)
    parser.add_argument("--extra-path", action="append", default=[])
    args = parser.parse_args()

    Path(args.session_dir).mkdir(parents=True, exist_ok=True)
    Path(args.workspace_dir).mkdir(parents=True, exist_ok=True)
    os.chdir(args.workspace_dir)

    stdin = sys.stdin
    # The bridge writer must bypass any active stdout redirect from a running
    # cell, so protocol lines go to the real pipe.
    def _write_line(line: str) -> None:
        sys.__stdout__.write(line + "\n")
        sys.__stdout__.flush()

    kernel = Kernel(
        _write_line,
        stdin.readline,
        session_id=args.session_id,
        session_dir=args.session_dir,
        workspace_dir=args.workspace_dir,
        exec_timeout_ms=args.exec_timeout_ms,
        extra_paths=args.extra_path,
    )
    kernel.run_forever()


if __name__ == "__main__":
    main()
