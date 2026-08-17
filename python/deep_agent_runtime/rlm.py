"""The ``rlm`` bridge: how kernel code reaches host-owned capabilities.

The TypeScript host owns provider execution, child lifecycles, scheduling, and
safety policy. Kernel code asks for those capabilities through typed
``host_request`` messages; the host validates each request and replies with a
payload (or an error). This module exposes the prime-agent-style surface:

    handle = await rlm("Review the auth flow", name="auth-reviewer")
    children = await rlm.list_subagents()
    await rlm.delete_subagent("auth-reviewer")
    await agent_message.send("done", receiver_role="parent")
    status = await rlm.goal.create("Implement the parser")

All requests block the kernel cell until the host replies, so results are
available inline — exactly like a synchronous function call from the model's
point of view.
"""

from __future__ import annotations

import importlib
import inspect
import json
import sys
import threading
import uuid
from typing import Any, Awaitable, Callable, TypeVar

T = TypeVar("T")


class HostError(RuntimeError):
    """Raised when the host rejects a request."""


class _Bridge:
    """Writes host_request messages and synchronously waits for replies."""

    def __init__(self, write_line: Callable[[str], None], read_line: Callable[[], str]):
        self._write_line = write_line
        self._read_line = read_line
        self._lock = threading.Lock()
        self._session: dict[str, Any] = {}

    def bind_session(self, session_id: str, session_dir: str, workspace_dir: str) -> None:
        self._session = {
            "session_id": session_id,
            "session_dir": session_dir,
            "workspace_dir": workspace_dir,
        }

    @property
    def session(self) -> dict[str, Any]:
        return dict(self._session)

    def request(self, kind: str, payload: dict[str, Any] | None = None) -> Any:
        """Send a host request and block until the host replies. Thread-safe."""
        request_id = uuid.uuid4().hex
        message = json.dumps(
            {
                "type": "host_request",
                "request_id": request_id,
                "request": {"kind": kind, **(payload or {})},
            }
        )
        with self._lock:
            self._write_line(message)
            while True:
                line = self._read_line()
                if line is None or line == "":  # EOF: the host is gone
                    raise HostError("host connection closed")
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "shutdown":
                    raise HostError("host shut the kernel down")
                if msg.get("type") != "host_response":
                    continue
                if msg.get("request_id") != request_id:
                    continue
                if msg.get("error"):
                    raise HostError(str(msg["error"]))
                return msg.get("payload")


class _Awaitable:
    """Turns a synchronous bridge request into an awaitable for top-level await."""

    def __init__(self, thunk: Callable[[], Any]):
        self._thunk = thunk

    def __await__(self):
        result = self._thunk()
        if False:  # pragma: no cover — keeps __await__ a generator function
            yield None
        return result


class _Rlm:
    """The callable ``rlm`` object preloaded in the kernel namespace."""

    def __init__(self, bridge: _Bridge):
        self._bridge = bridge
        self.goal = _Goal(bridge)
        self.skills = _Skills(bridge)

    def __call__(self, prompt: str, name: str | None = None) -> Awaitable[dict[str, Any]]:
        return _Awaitable(
            lambda: self._bridge.request(
                "spawn_child", {"prompt": prompt, **({"name": name} if name else {})}
            )
        )

    def list_subagents(self) -> Awaitable[list[dict[str, Any]]]:
        return _Awaitable(lambda: self._bridge.request("list_subagents"))

    def delete_subagent(self, name_or_id: str) -> Awaitable[dict[str, Any]]:
        return _Awaitable(
            lambda: self._bridge.request("delete_subagent", {"name_or_id": name_or_id})
        )

    def host_request(self, kind: str, payload: dict[str, Any] | None = None) -> Awaitable[Any]:
        return _Awaitable(lambda: self._bridge.request(kind, payload))

    @property
    def session(self) -> dict[str, Any]:
        return self._bridge.session

    @property
    def session_dir(self) -> str:
        return str(self._bridge.session.get("session_dir", ""))

    @property
    def workspace_dir(self) -> str:
        return str(self._bridge.session.get("workspace_dir", ""))

    @property
    def session_id(self) -> str:
        return str(self._bridge.session.get("session_id", ""))


def _introspect_module(module: Any) -> dict[str, Any]:
    functions: list[dict[str, str]] = []
    for attr in dir(module):
        if attr.startswith("_"):
            continue
        obj = getattr(module, attr)
        if not callable(obj):
            continue
        if getattr(obj, "__module__", None) != module.__name__:
            continue
        try:
            signature = str(inspect.signature(obj))
        except (TypeError, ValueError):
            signature = "(...)"
        doc = (inspect.getdoc(obj) or "").strip().split("\n")[0]
        functions.append({"name": attr, "signature": signature, "doc": doc})
    return {
        "package": module.__name__,
        "functions": sorted(functions, key=lambda f: f["name"]),
    }


class _Skills:
    """``rlm.skills`` — the installed Agent Skills suite, owned by the host.

    Only metadata (name + description) sits in the system prompt; load the
    full SKILL.md when a task matches, and install new skills from a local
    directory when one is needed. Skills that ship a Python package expose it
    through import_python().
    """

    def __init__(self, bridge: _Bridge):
        self._bridge = bridge

    def list(self) -> Awaitable[list[dict[str, str]]]:
        return _Awaitable(lambda: self._bridge.request("skills_list"))

    def load(self, name: str) -> Awaitable[dict[str, str]]:
        return _Awaitable(lambda: self._bridge.request("skills_load", {"name": name}))

    def install(self, source_dir: str) -> Awaitable[dict[str, str]]:
        return _Awaitable(
            lambda: self._bridge.request("skills_install", {"source": source_dir})
        )

    def import_python(self, name: str) -> Awaitable[dict[str, Any]]:
        """Register a Python-backed skill's package and return its public API.

        The host validates the skill and returns the package dir; the kernel
        puts it on sys.path, imports it, and reports every public function
        with its signature and one-line doc. The model then imports the package
        in a cell and calls the functions directly.
        """

        def thunk() -> dict[str, Any]:
            payload = self._bridge.request("skills_import", {"name": name})
            path = str(payload["path"])
            package = str(payload["package"])
            if path not in sys.path:
                sys.path.insert(0, path)
            try:
                module = importlib.import_module(package)
            except Exception as exc:  # surface import failures as host errors
                raise HostError(f"failed to import {package}: {exc}") from exc
            return _introspect_module(module)

        return _Awaitable(thunk)


class _Goal:
    def __init__(self, bridge: _Bridge):
        self._bridge = bridge

    def create(self, objective: str, sovereign: bool = False) -> Awaitable[dict[str, Any]]:
        return _Awaitable(
            lambda: self._bridge.request(
                "goal_create", {"objective": objective, "sovereign": sovereign}
            )
        )

    def status(self) -> Awaitable[dict[str, Any]]:
        return _Awaitable(lambda: self._bridge.request("goal_status"))

    def complete(self, summary: str = "") -> Awaitable[dict[str, Any]]:
        return _Awaitable(
            lambda: self._bridge.request("goal_complete", {"summary": summary})
        )

    def block(self, reason: str) -> Awaitable[dict[str, Any]]:
        return _Awaitable(lambda: self._bridge.request("goal_block", {"reason": reason}))


class _AgentMessage:
    """``agent_message.send`` — reply to the parent or follow up with a child."""

    def __init__(self, bridge: _Bridge):
        self._bridge = bridge

    def send(
        self,
        message: str,
        receiver_role: str = "parent",
        receiver_name: str | None = None,
    ) -> Awaitable[dict[str, Any]]:
        payload: dict[str, Any] = {"message": message, "receiver_role": receiver_role}
        if receiver_name:
            payload["receiver_name"] = receiver_name
        return _Awaitable(lambda: self._bridge.request("send_message", payload))


def build(bridge: _Bridge) -> dict[str, Any]:
    """Build the objects preloaded into the kernel namespace."""
    rlm = _Rlm(bridge)
    return {"rlm": rlm, "agent_message": _AgentMessage(bridge)}
