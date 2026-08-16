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


class _Goal:
    def __init__(self, bridge: _Bridge):
        self._bridge = bridge

    def create(self, objective: str) -> Awaitable[dict[str, Any]]:
        return _Awaitable(lambda: self._bridge.request("goal_create", {"objective": objective}))

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
