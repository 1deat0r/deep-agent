"""In-process tests for the kernel: no subprocess needed, the host side is simulated."""

from __future__ import annotations

import json
import queue
import tempfile
import threading
import unittest
from pathlib import Path

from deep_agent_runtime.kernel import Kernel


class FakeHost:
    """Simulates the TypeScript host on the other end of the JSON pipe.

    Single-threaded: `exec` consumes kernel output itself and answers
    host_request lines inline, which avoids two consumers racing on one queue.
    """

    def __init__(self):
        self.to_kernel: "queue.Queue[str]" = queue.Queue()
        self.from_kernel: "queue.Queue[str]" = queue.Queue()
        self.requests: list[dict] = []
        self.reply_error: str | None = None

    def exec(self, code: str, host_reply: dict | None = None) -> dict:
        exec_id = f"exec-{len(self.requests)}-{id(code) % 1000}"
        self.to_kernel.put(json.dumps({"type": "exec", "id": exec_id, "code": code}))
        while True:
            line = self.from_kernel.get(timeout=15)
            msg = json.loads(line)
            if msg.get("type") == "result" and msg.get("id") == exec_id:
                return msg
            if msg.get("type") == "host_request":
                self.requests.append(msg)
                response: dict = {"type": "host_response", "request_id": msg["request_id"]}
                if self.reply_error is not None:
                    response["error"] = self.reply_error
                else:
                    response["payload"] = host_reply or {"ok": True}
                self.to_kernel.put(json.dumps(response))


class KernelTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.session_dir = str(Path(tmp.name) / "session")
        self.workspace_dir = str(Path(tmp.name) / "workspace")
        Path(self.workspace_dir).mkdir(parents=True)
        self.host = FakeHost()
        self.kernel = Kernel(
            lambda line: self.host.from_kernel.put(line),
            self.host.to_kernel.get,
            session_id="s1",
            session_dir=self.session_dir,
            workspace_dir=self.workspace_dir,
        )
        self.thread = threading.Thread(target=self.kernel.run_forever, daemon=True)
        self.thread.start()
        # ready handshake
        ready = json.loads(self.host.from_kernel.get(timeout=15))
        self.assertEqual(ready["type"], "ready")

    def tearDown(self):
        self.host.to_kernel.put(json.dumps({"type": "shutdown"}))
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            raise AssertionError("kernel thread did not shut down")

    def test_basic_exec_and_repr(self):
        result = self.host.exec("x = 40 + 2")
        self.assertIsNone(result["error"], result)
        result = self.host.exec("x")
        self.assertEqual(result["result_repr"], "42")

    def test_stdout_capture_and_state_persistence(self):
        self.host.exec("total = 0")
        result = self.host.exec("total += 7\nprint('total is', total)")
        self.assertEqual(result["stdout"].strip(), "total is 7")
        self.assertIsNone(result["error"])
        self.assertEqual(self.host.exec("total")["result_repr"], "7")

    def test_exception_captured(self):
        result = self.host.exec("1 / 0")
        self.assertEqual(result["error"]["type"], "ZeroDivisionError")
        self.assertTrue(
            any("ZeroDivisionError" in line for line in result["error"]["traceback"])
        )

    def test_syntax_error_captured(self):
        result = self.host.exec("def broken(:")
        self.assertIsNotNone(result["error"])
        self.assertIn("SyntaxError", result["error"]["type"])

    def test_shell_cell_magic(self):
        result = self.host.exec("%%bash\necho hello-from-bash\npwd\n")
        self.assertIn("hello-from-bash", result["stdout"])
        self.assertIn(self.workspace_dir, result["stdout"])
        self.assertIsNone(result["error"])

    def test_bang_and_cd_magics(self):
        self.host.exec("%cd ..")
        result = self.host.exec("!echo bang-works")
        self.assertIn("bang-works", result["stdout"])

    def test_top_level_await_rlm_spawn(self):
        result = self.host.exec(
            'handle = await rlm("Review the auth flow", name="auth-reviewer")\nhandle',
            host_reply={
                "handle": {
                    "child_id": "c1",
                    "name": "auth-reviewer",
                    "session_dir": "/tmp/x",
                }
            },
        )
        self.assertIsNone(result["error"], result)
        self.assertIn("'child_id'", result["result_repr"])
        self.assertEqual(len(self.host.requests), 1)
        req = self.host.requests[0]["request"]
        self.assertEqual(req["kind"], "spawn_child")
        self.assertEqual(req["prompt"], "Review the auth flow")
        self.assertEqual(req["name"], "auth-reviewer")

    def test_agent_message_and_goal_requests(self):
        self.host.exec('await agent_message.send("done", receiver_role="parent")')
        self.host.exec('status = await rlm.goal.create("Implement the parser")\nstatus')
        kinds = [r["request"]["kind"] for r in self.host.requests]
        self.assertEqual(kinds, ["send_message", "goal_create"])
        msg = self.host.requests[0]["request"]
        self.assertEqual(msg["receiver_role"], "parent")
        self.assertEqual(msg["message"], "done")

    def test_rlm_skills_import_python(self):
        import tempfile
        from pathlib import Path

        pkg_dir = Path(tempfile.mkdtemp())
        (pkg_dir / "demo_skill").mkdir()
        (pkg_dir / "demo_skill" / "__init__.py").write_text(
            "def double(n):\n    \"\"\"Double a number.\"\"\"\n    return n * 2\n"
        )
        result = self.host.exec(
            'api = await rlm.skills.import_python("demo-skill")\napi',
            host_reply={"package": "demo_skill", "path": str(pkg_dir)},
        )
        self.assertIsNone(result["error"], result)
        self.assertIn("demo_skill", result["result_repr"])
        self.assertIn("double", result["result_repr"])
        self.assertEqual(self.host.requests[0]["request"]["kind"], "skills_import")
        # the path landed on sys.path, so a plain import works afterwards
        result2 = self.host.exec("import demo_skill\ndemo_skill.double(21)")
        self.assertEqual(result2["result_repr"], "42")

    def test_rlm_skills_requests(self):
        self.host.exec(
            "skills = await rlm.skills.list()\nskills",
            host_reply=[
                {"name": "tdd", "description": "Test-driven development"},
                {"name": "research", "description": "Investigate a question"},
            ],
        )
        self.host.exec(
            'skill = await rlm.skills.load("tdd")\nskill',
            host_reply={"name": "tdd", "content": "# TDD\nfull instructions"},
        )
        self.host.exec(
            'await rlm.skills.install("/workspace/new-skill")',
            host_reply={"name": "new-skill", "description": "fresh"},
        )
        kinds = [r["request"]["kind"] for r in self.host.requests]
        self.assertEqual(kinds, ["skills_list", "skills_load", "skills_install"])
        load_req = self.host.requests[1]["request"]
        self.assertEqual(load_req["name"], "tdd")
        install_req = self.host.requests[2]["request"]
        self.assertEqual(install_req["source"], "/workspace/new-skill")

    def test_rlm_session_info(self):
        result = self.host.exec("rlm.session_id, rlm.session_dir, rlm.workspace_dir")
        self.assertIn("'s1'", result["result_repr"])
        self.assertIn(self.session_dir, result["result_repr"])
        self.assertIn(self.workspace_dir, result["result_repr"])

    def test_host_error_raises_in_cell(self):
        self.host.reply_error = "host rejected the request"
        result = self.host.exec('await rlm("boom")')
        self.assertEqual(result["error"]["type"], "HostError")
        self.assertIn("host rejected", result["error"]["message"])

    def test_interrupt_sigusr1(self):
        if not hasattr(__import__("signal"), "SIGUSR1"):
            self.skipTest("no SIGUSR1 on this platform")
        kernel = Kernel(
            lambda line: self.host.from_kernel.put(line),
            self.host.to_kernel.get,
            session_id="s-i",
            session_dir=self.session_dir,
            workspace_dir=self.workspace_dir,
        )

        def _interrupt_later():
            time.sleep(0.3)
            os.kill(os.getpid(), __import__("signal").SIGUSR1)

        import threading
        import time
        import os

        threading.Thread(target=_interrupt_later, daemon=True).start()
        started = time.monotonic()
        result = kernel._execute("while True:\n    pass")
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 3, "interrupt did not stop the cell")
        self.assertIsNotNone(result["error"])
        self.assertIn("interrupted by host", result["error"]["message"])

    def test_namespace_survives_across_cells_with_functions(self):
        self.host.exec("def double(n):\n    return n * 2")
        result = self.host.exec("double(21)")
        self.assertEqual(result["result_repr"], "42")

    def test_timeout_option(self):
        if not hasattr(__import__("signal"), "setitimer"):
            self.skipTest("no setitimer on this platform")
        # Drive _execute on the main thread: signals only fire there.
        kernel = Kernel(
            lambda line: self.host.from_kernel.put(line),
            self.host.to_kernel.get,
            session_id="s-t",
            session_dir=self.session_dir,
            workspace_dir=self.workspace_dir,
            exec_timeout_ms=200,
        )
        result = kernel._execute("import time\ntime.sleep(5)")
        self.assertIsNotNone(result["error"])
        self.assertIn("timeout", result["error"]["message"])


if __name__ == "__main__":
    unittest.main()
