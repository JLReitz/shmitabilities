#!/usr/bin/env python3
"""
Prompt-driven Codex app-server evidence harness.

Captures raw JSON-RPC traffic for the remaining prompt-drivable scenarios:
approval wait, explicit user-input wait, failed-tool command execution,
mid-turn steering, and web/search-fetched tool shapes.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_OUTPUT_DIR = Path("/tmp/codex-app-test2")
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_SOURCE_CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
DEFAULT_SCENARIOS = (
    "approval-wait",
    "explicit-user-input-wait",
    "failed-tool-command-execution",
    "successful-turn-steer",
    "thread-resume-turn-start",
    "web-search-fetch",
)


class WebSocketClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.sock: socket.socket | None = None
        self._recv_buf = b""
        self._send_lock = threading.Lock()

    def connect(self, timeout: float = 15.0) -> None:
        parsed = urlparse(self.endpoint)
        if parsed.scheme == "ws":
            host = parsed.hostname or "127.0.0.1"
            port = parsed.port
            if port is None:
                raise ValueError(f"Missing port in websocket endpoint: {self.endpoint}")
            self.sock = socket.create_connection((host, port), timeout=timeout)
            self.sock.settimeout(timeout)
        elif parsed.scheme == "unix":
            target = parsed.path or parsed.netloc
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(timeout)
            self.sock.connect(target)
        else:
            raise ValueError(f"Unsupported websocket endpoint: {self.endpoint}")
        self._do_handshake()

    def _do_handshake(self) -> None:
        assert self.sock is not None
        key = "dGhlIHNhbXBsZSBub25jZQ=="
        request = (
            "GET / HTTP/1.1\r\n"
            "Host: localhost\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ).encode("ascii")
        self.sock.sendall(request)
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("Server closed during websocket handshake")
            response += chunk
        header = response.decode("ascii", errors="replace")
        if "101" not in header.split("\r\n")[0]:
            raise ConnectionError(f"Handshake failed: {header[:200]}")
        self._recv_buf = response[response.index(b"\r\n\r\n") + 4 :]

    def send_json(self, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        frame = self._build_frame(0x1, body)
        with self._send_lock:
            assert self.sock is not None
            self.sock.sendall(frame)

    def recv_json(self, timeout: float = 15.0) -> dict[str, Any] | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            remaining = max(0.1, min(1.0, deadline - time.monotonic()))
            frame = self._read_frame_data(timeout=remaining)
            if frame is None:
                continue
            try:
                return json.loads(frame.decode("utf-8"))
            except json.JSONDecodeError:
                continue
        return None

    def recv_until_quiet(
        self,
        total_timeout: float,
        quiet_period: float = 2.0,
        stop_methods: set[str] | None = None,
        require_stop_before_quiet: bool = False,
        max_messages: int = 1000,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        deadline = time.monotonic() + total_timeout
        last_message_at = time.monotonic()
        stop_seen = False
        while time.monotonic() < deadline and len(messages) < max_messages:
            msg = self.recv_json(timeout=min(1.0, deadline - time.monotonic()))
            if msg is None:
                if (
                    messages
                    and time.monotonic() - last_message_at >= quiet_period
                    and (not require_stop_before_quiet or stop_seen or not stop_methods)
                ):
                    break
                continue
            messages.append(msg)
            last_message_at = time.monotonic()
            if stop_methods and msg.get("method") in stop_methods:
                stop_seen = True
                break
        return messages

    def _build_frame(self, opcode: int, payload: bytes) -> bytes:
        mask_key = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(length | 0x80)
        elif length < 65536:
            header.append(126 | 0x80)
            header.extend(length.to_bytes(2, "big"))
        else:
            header.append(127 | 0x80)
            header.extend(length.to_bytes(8, "big"))
        header.extend(mask_key)
        masked = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        return bytes(header) + masked

    def _read_frame_data(self, timeout: float) -> bytes | None:
        buffer = self._recv_buf
        self._recv_buf = b""
        while True:
            if len(buffer) < 2:
                chunk = self._read_some(timeout)
                if chunk is None:
                    self._recv_buf = buffer
                    return None
                buffer += chunk
                continue
            opcode = buffer[0] & 0x0F
            masked = (buffer[1] & 0x80) != 0
            length = buffer[1] & 0x7F
            offset = 2
            if length == 126:
                if len(buffer) < 4:
                    chunk = self._read_some(timeout)
                    if chunk is None:
                        self._recv_buf = buffer
                        return None
                    buffer += chunk
                    continue
                length = int.from_bytes(buffer[2:4], "big")
                offset = 4
            elif length == 127:
                if len(buffer) < 10:
                    chunk = self._read_some(timeout)
                    if chunk is None:
                        self._recv_buf = buffer
                        return None
                    buffer += chunk
                    continue
                length = int.from_bytes(buffer[2:10], "big")
                offset = 10
            mask_key = None
            if masked:
                if len(buffer) < offset + 4:
                    chunk = self._read_some(timeout)
                    if chunk is None:
                        self._recv_buf = buffer
                        return None
                    buffer += chunk
                    continue
                mask_key = buffer[offset : offset + 4]
                offset += 4
            if len(buffer) < offset + length:
                chunk = self._read_some(timeout)
                if chunk is None:
                    self._recv_buf = buffer
                    return None
                buffer += chunk
                continue
            payload = buffer[offset : offset + length]
            self._recv_buf = buffer[offset + length :]
            if opcode == 0x8:
                return None
            if opcode == 0x9:
                self._send_pong(payload)
                buffer = self._recv_buf
                self._recv_buf = b""
                continue
            if opcode in (0x1, 0x2):
                if mask_key is not None:
                    payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
                return payload
            buffer = self._recv_buf
            self._recv_buf = b""

    def _send_pong(self, payload: bytes) -> None:
        assert self.sock is not None
        with self._send_lock:
            self.sock.sendall(self._build_frame(0xA, payload))

    def _read_some(self, timeout: float) -> bytes | None:
        assert self.sock is not None
        self.sock.settimeout(timeout)
        try:
            chunk = self.sock.recv(65536)
            return chunk if chunk else None
        except (socket.timeout, OSError):
            return None

    def close(self) -> None:
        if not self.sock:
            return
        try:
            with self._send_lock:
                self.sock.sendall(self._build_frame(0x8, b""))
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass
        self.sock = None


class StreamCollector:
    def __init__(self, stream: Any):
        self._stream = stream
        self._parts: list[str] = []
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        if self._stream is None:
            return
        for line in self._stream:
            self._parts.append(line)

    def join(self, timeout: float = 5.0) -> str:
        self._thread.join(timeout)
        return "".join(self._parts)

    def text(self) -> str:
        return "".join(self._parts)


@dataclass(frozen=True)
class Scenario:
    slug: str
    output_name: str
    prompt: str
    description: str
    thread_cwd_mode: str = "temp"
    required_features: tuple[str, ...] = ()
    app_server_config_overrides: tuple[str, ...] = ()
    total_timeout: float = 90.0
    quiet_period: float = 2.0
    stop_methods: tuple[str, ...] = ("turn/completed",)
    require_stop_before_quiet: bool = False
    steer_prompt: str | None = None
    steer_wait_for_methods: tuple[str, ...] = ()
    steer_wait_for_item_types: tuple[str, ...] = ()
    steer_wait_timeout: float = 15.0


@dataclass
class TurnRunResult:
    start_response: dict[str, Any]
    messages: list[dict[str, Any]]
    steer_request: dict[str, Any] | None = None
    steer_response: dict[str, Any] | None = None
    steer_sent: bool = False
    steer_completed_before_send: bool = False
    steer_triggered_by: dict[str, Any] | None = None


@dataclass
class AppServerProcess:
    proc: subprocess.Popen[str]
    stdout: StreamCollector
    stderr: StreamCollector
    listen_url: str

    def wait_for_listen(self, timeout: float = 20.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                return False
            logs = self.stdout.text() + self.stderr.text()
            if "listening on:" in logs:
                return True
            time.sleep(0.2)
        logs = self.stdout.text() + self.stderr.text()
        return "listening on:" in logs

    def terminate(self) -> dict[str, Any]:
        if self.proc.poll() is None:
            try:
                self.proc.send_signal(signal.SIGINT)
                self.proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait(timeout=5.0)
        return {
            "exit_code": self.proc.returncode,
            "stdout": self.stdout.join(),
            "stderr": self.stderr.join(),
        }


@dataclass(frozen=True)
class HookCaptureContext:
    codex_home: Path
    hook_log_path: Path
    hook_script_path: Path


SCENARIOS: dict[str, Scenario] = {
    "approval-wait": Scenario(
        slug="approval-wait",
        output_name="09_approval_wait.json",
        description="Prompt that should require approval before a workspace write.",
        prompt=(
            "Before answering, create a new file named approval-required.txt in the "
            "current working directory containing exactly APPROVAL-WAIT-CAPTURE. "
            "If you need operator approval to run the command, request approval and "
            "wait instead of continuing. Do not offer alternatives."
        ),
        thread_cwd_mode="repo",
        total_timeout=75.0,
        quiet_period=3.0,
        stop_methods=(),
    ),
    "explicit-user-input-wait": Scenario(
        slug="explicit-user-input-wait",
        output_name="10_explicit_user_input_wait.json",
        description="Prompt that should force a clarifying question and a wait for input.",
        prompt=(
            "You are missing one required input: the deployment environment name. "
            "Ask exactly one concise clarifying question requesting that value, then "
            "stop and wait for my answer. Do not make assumptions, do not give a "
            "provisional answer, and do not continue past the question."
        ),
        total_timeout=60.0,
        quiet_period=3.0,
        stop_methods=(),
    ),
    "failed-tool-command-execution": Scenario(
        slug="failed-tool-command-execution",
        output_name="11_failed_tool_command_execution.json",
        description="Prompt that should produce a deterministic failing commandExecution item.",
        prompt=(
            "Run the command `definitely-not-a-real-command-pi-shmits-angels` in the "
            "current working directory, then report the failure briefly."
        ),
        total_timeout=75.0,
    ),
    "successful-turn-steer": Scenario(
        slug="successful-turn-steer",
        output_name="13_successful_turn_steer.json",
        description="Prompt and mid-turn steer path intended to capture an accepted active-turn steer.",
        prompt=(
            "Run `/bin/bash -lc 'sleep 8; printf INITIAL-LONG-RUN-DONE'` in the "
            "current working directory. After that command finishes, reply with "
            "exactly one line containing ORIGINAL-RESULT. If I send more user input "
            "while you are still working, treat it as part of the same request and "
            "follow the latest instruction."
        ),
        steer_prompt=(
            "Update the same in-flight turn. Ignore the earlier exact-output "
            "instruction. After the current work finishes, reply with exactly one "
            "line containing STEERED-RESULT."
        ),
        total_timeout=90.0,
        quiet_period=3.0,
        require_stop_before_quiet=True,
        steer_wait_for_item_types=("commandExecution",),
        steer_wait_timeout=20.0,
    ),
    "thread-resume-turn-start": Scenario(
        slug="thread-resume-turn-start",
        output_name="14_thread_resume_turn_start.json",
        description="Disconnect, resume the existing thread on a new connection, then deliver a resumed turn.",
        prompt=(
            "Return exactly one line containing RESUMED-THREAD-RESULT. Do not add "
            "any other text."
        ),
        total_timeout=60.0,
        quiet_period=3.0,
        require_stop_before_quiet=True,
    ),
    "web-search-fetch": Scenario(
        slug="web-search-fetch",
        output_name="12_web_search_fetch.json",
        description="Prompt that should use the web/search tool path instead of a shell tool.",
        prompt=(
            "Use web search or web fetch to find the current Codex CLI version. "
            "Return exactly two lines: the version number on the first line and one "
            "source URL on the second line."
        ),
        app_server_config_overrides=('web_search="live"',),
        total_timeout=90.0,
        quiet_period=3.0,
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture prompt-driven Codex app-server evidence over loopback WebSockets."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for JSON artifacts (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--cwd",
        type=Path,
        default=Path.cwd(),
        help="Workspace root to use when starting the app-server and threads.",
    )
    parser.add_argument(
        "--codex-home",
        type=Path,
        help="Optional CODEX_HOME override. Defaults to inheriting the current environment.",
    )
    parser.add_argument(
        "--scenario",
        action="append",
        choices=sorted(SCENARIOS),
        help="Scenario to run. Repeatable. Defaults to all prompt-driven scenarios.",
    )
    return parser.parse_args()


def reserve_loopback_ws_url() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"ws://127.0.0.1:{port}"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def resolve_source_codex_home(codex_home: Path | None) -> Path | None:
    candidate = codex_home or DEFAULT_SOURCE_CODEX_HOME
    return candidate.resolve() if candidate.exists() else None


def trusted_project_config(paths: list[Path]) -> str:
    lines: list[str] = []
    seen: set[str] = set()
    for path in paths:
        resolved = path.resolve()
        for candidate in [resolved, *resolved.parents]:
            candidate_str = str(candidate)
            if (candidate / ".codex").is_dir() and candidate_str not in seen:
                lines.extend(
                    [
                        f'[projects.{json.dumps(candidate_str)}]',
                        'trust_level = "trusted"',
                        "",
                    ]
                )
                seen.add(candidate_str)
    return "\n".join(lines)


def write_hook_capture_script(path: Path) -> None:
    script = """#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    log_path = Path(sys.argv[1])
    declared_event = sys.argv[2] if len(sys.argv) > 2 else None
    stdin_raw = sys.stdin.read()
    stdin_json = None
    if stdin_raw.strip():
        try:
            stdin_json = json.loads(stdin_raw)
        except json.JSONDecodeError:
            stdin_json = None
    record = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "declared_event": declared_event,
        "cwd": os.getcwd(),
        "pid": os.getpid(),
        "stdin_raw": stdin_raw,
        "stdin_json": stdin_json,
        "env": {
            key: value
            for key, value in os.environ.items()
            if key.startswith("CODEX_") or key in {"PWD", "HOME"}
        },
    }
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(0o755)


def build_capture_codex_home(
    base: Path,
    source_codex_home: Path | None,
    trusted_paths: list[Path],
) -> HookCaptureContext:
    base.mkdir(parents=True, exist_ok=True)
    if source_codex_home is not None:
        for filename in ("auth.json", "installation_id"):
            source = source_codex_home / filename
            if source.is_file():
                shutil.copy2(source, base / filename)

    hook_script_path = base / "capture_stop_hook.py"
    hook_log_path = base / "hook-captures.jsonl"
    write_hook_capture_script(hook_script_path)

    trusted_projects = trusted_project_config(trusted_paths)
    config_toml = "\n".join(
        [
            f"model = {json.dumps(DEFAULT_MODEL)}",
            "[features]",
            "hooks = true",
            "",
            trusted_projects,
        ]
    )
    (base / "config.toml").write_text(config_toml, encoding="utf-8")

    def hook_command(event_name: str) -> str:
        return " ".join(
            [
                json.dumps("/usr/bin/python3"),
                json.dumps(str(hook_script_path)),
                json.dumps(str(hook_log_path)),
                json.dumps(event_name),
            ]
        )

    hooks_json = {
        "hooks": {
            "PostToolUse": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": hook_command("PostToolUse"),
                            "timeout": 15,
                        }
                    ]
                }
            ],
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": hook_command("Stop"),
                            "timeout": 15,
                        }
                    ]
                }
            ],
            "SubagentStop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": hook_command("SubagentStop"),
                            "timeout": 15,
                        }
                    ]
                }
            ],
        }
    }
    (base / "hooks.json").write_text(json.dumps(hooks_json, indent=2), encoding="utf-8")
    return HookCaptureContext(
        codex_home=base,
        hook_log_path=hook_log_path,
        hook_script_path=hook_script_path,
    )


def read_hook_artifacts(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    artifacts: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            artifacts.append(json.loads(line))
        except json.JSONDecodeError:
            artifacts.append({"parse_error": True, "stdin_raw": line})
    return artifacts


def start_app_server(
    cwd: Path,
    model: str,
    required_features: tuple[str, ...],
    config_overrides: tuple[str, ...],
    codex_home: Path | None,
    *,
    bypass_hook_trust: bool = False,
) -> AppServerProcess:
    listen_url = reserve_loopback_ws_url()
    command = ["codex", "app-server", "--listen", listen_url, "-c", f"model={json.dumps(model)}"]
    if bypass_hook_trust:
        command.insert(1, "--dangerously-bypass-hook-trust")
    for feature in required_features:
        command.extend(["--enable", feature])
    for override in config_overrides:
        command.extend(["-c", override])
    env = os.environ.copy()
    if codex_home is not None:
        env["CODEX_HOME"] = str(codex_home)
    proc = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(cwd),
        env=env,
        start_new_session=True,
    )
    assert proc.stdout is not None
    assert proc.stderr is not None
    return AppServerProcess(
        proc=proc,
        stdout=StreamCollector(proc.stdout),
        stderr=StreamCollector(proc.stderr),
        listen_url=listen_url,
    )


def initialize_client(ws: WebSocketClient) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    messages.extend(ws.recv_until_quiet(total_timeout=1.0, quiet_period=0.5))

    ws.send_json(
        {
            "jsonrpc": "2.0",
            "id": "init",
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "pi-shmits-angels-app-server-capture",
                    "version": "0.2.0",
                }
            },
        }
    )
    init_response = ws.recv_json(timeout=10.0) or {}
    if init_response:
        messages.append(init_response)
    ws.send_json({"jsonrpc": "2.0", "method": "initialized"})
    messages.extend(ws.recv_until_quiet(total_timeout=2.0, quiet_period=0.75))
    return messages, init_response


def start_thread(
    ws: WebSocketClient,
    cwd: Path,
    model: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    ws.send_json(
        {
            "jsonrpc": "2.0",
            "id": "thread-start",
            "method": "thread/start",
            "params": {
                "model": model,
                "cwd": str(cwd),
            },
        }
    )
    thread_response = ws.recv_json(timeout=15.0) or {}
    messages = [thread_response] if thread_response else []
    messages.extend(ws.recv_until_quiet(total_timeout=4.0, quiet_period=1.0))
    return thread_response, messages


def initialize_session(
    ws: WebSocketClient,
    scenario: Scenario,
    cwd: Path,
    model: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    messages, init_response = initialize_client(ws)
    thread_response, thread_messages = start_thread(ws, cwd, model)
    messages.extend(thread_messages)

    thread_id = (
        thread_response.get("result", {}).get("thread", {}).get("id")
        if thread_response
        else None
    )
    if not thread_id:
        raise RuntimeError(f"Failed to start thread for scenario {scenario.slug}")
    return messages, init_response, thread_response


def resume_thread(
    ws: WebSocketClient,
    thread_id: str,
    cwd: Path,
    model: str,
    thread_path: str | None = None,
    request_id: str = "thread-resume",
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    params: dict[str, Any] = {
        "threadId": thread_id,
        "cwd": str(cwd),
        "model": model,
    }
    if thread_path:
        params["path"] = thread_path
    ws.send_json(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "thread/resume",
            "params": params,
        }
    )
    resume_response = ws.recv_json(timeout=15.0) or {}
    messages = [resume_response] if resume_response else []
    messages.extend(ws.recv_until_quiet(total_timeout=4.0, quiet_period=1.0))
    return resume_response, messages


def read_thread(
    ws: WebSocketClient,
    thread_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    ws.send_json(
        {
            "jsonrpc": "2.0",
            "id": "thread-read",
            "method": "thread/read",
            "params": {
                "threadId": thread_id,
                "includeTurns": True,
            },
        }
    )
    response = ws.recv_json(timeout=15.0) or {}
    messages = [response] if response else []
    messages.extend(ws.recv_until_quiet(total_timeout=2.0, quiet_period=0.75))
    return response, messages


def message_item_type(message: dict[str, Any]) -> str | None:
    item = message.get("params", {}).get("item")
    if isinstance(item, dict):
        item_type = item.get("type")
        if isinstance(item_type, str):
            return item_type
    return None


def maybe_send_steer(
    ws: WebSocketClient,
    scenario: Scenario,
    thread_id: str,
    turn_id: str,
    messages: list[dict[str, Any]],
) -> tuple[
    list[dict[str, Any]],
    bool,
    bool,
    dict[str, Any] | None,
    dict[str, Any] | None,
    dict[str, Any] | None,
]:
    deadline = time.monotonic() + scenario.steer_wait_timeout
    steer_triggered_by: dict[str, Any] | None = None
    steer_completed_before_send = False
    while time.monotonic() < deadline:
        message = ws.recv_json(timeout=min(1.0, deadline - time.monotonic()))
        if message is None:
            continue
        messages.append(message)
        if message.get("method") == "turn/completed":
            steer_completed_before_send = True
            break
        method = message.get("method")
        item_type = message_item_type(message)
        if (
            isinstance(method, str)
            and method in scenario.steer_wait_for_methods
        ) or (
            isinstance(item_type, str)
            and item_type in scenario.steer_wait_for_item_types
        ):
            steer_triggered_by = {"method": method, "item_type": item_type}
            break

    if steer_completed_before_send:
        return (
            messages,
            False,
            True,
            steer_triggered_by,
            None,
            None,
        )

    if steer_triggered_by is None:
        steer_triggered_by = {"method": "timeout_fallback", "item_type": None}

    steer_request = {
        "jsonrpc": "2.0",
        "id": "turn-steer",
        "method": "turn/steer",
        "params": {
            "threadId": thread_id,
            "expectedTurnId": turn_id,
            "input": [{"type": "text", "text": scenario.steer_prompt}],
        },
    }
    ws.send_json(steer_request)
    steer_response = ws.recv_json(timeout=15.0) or {}
    if steer_response:
        messages.append(steer_response)
    return (
        messages,
        True,
        False,
        steer_triggered_by,
        steer_request,
        steer_response,
    )


def run_turn(
    ws: WebSocketClient,
    thread_id: str,
    scenario: Scenario,
    model: str,
) -> TurnRunResult:
    ws.send_json(
        {
            "jsonrpc": "2.0",
            "id": "turn-start",
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "input": [{"type": "text", "text": scenario.prompt}],
                "model": model,
            },
        }
    )
    response = ws.recv_json(timeout=30.0) or {}
    messages = [response] if response else []
    steer_request: dict[str, Any] | None = None
    steer_response: dict[str, Any] | None = None
    steer_sent = False
    steer_completed_before_send = False
    steer_triggered_by: dict[str, Any] | None = None
    started_at = time.monotonic()

    if scenario.steer_prompt:
        turn_id = response.get("result", {}).get("turn", {}).get("id")
        if isinstance(turn_id, str) and turn_id:
            (
                messages,
                steer_sent,
                steer_completed_before_send,
                steer_triggered_by,
                steer_request,
                steer_response,
            ) = maybe_send_steer(
                ws=ws,
                scenario=scenario,
                thread_id=thread_id,
                turn_id=turn_id,
                messages=messages,
            )

    remaining_timeout = max(1.0, scenario.total_timeout - (time.monotonic() - started_at))
    messages.extend(
        ws.recv_until_quiet(
            total_timeout=remaining_timeout,
            quiet_period=scenario.quiet_period,
            stop_methods=set(scenario.stop_methods),
            require_stop_before_quiet=scenario.require_stop_before_quiet,
        )
    )
    return TurnRunResult(
        start_response=response,
        messages=messages,
        steer_request=steer_request,
        steer_response=steer_response,
        steer_sent=steer_sent,
        steer_completed_before_send=steer_completed_before_send,
        steer_triggered_by=steer_triggered_by,
    )


def run_resume_scenario(
    scenario: Scenario,
    output_dir: Path,
    cwd: Path,
    model: str,
    codex_home: Path | None,
) -> Path:
    workspace_root = output_dir / ".scenario-workspaces"
    workspace_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f"{scenario.slug}-",
        dir=workspace_root,
    ) as temp_dir:
        temp_root = Path(temp_dir)
        scenario_cwd = temp_root
        hook_context = build_capture_codex_home(
            temp_root / "codex-home",
            resolve_source_codex_home(codex_home),
            [cwd, scenario_cwd],
        )
        app = start_app_server(
            cwd,
            model,
            scenario.required_features,
            scenario.app_server_config_overrides,
            hook_context.codex_home,
            bypass_hook_trust=True,
        )
        if not app.wait_for_listen(timeout=20.0):
            process_info = app.terminate()
            artifact = {
                "scenario": scenario.slug,
                "description": scenario.description,
                "prompt": scenario.prompt,
                "required_features": list(scenario.required_features),
                "app_server_config_overrides": list(scenario.app_server_config_overrides),
                "thread_cwd_mode": scenario.thread_cwd_mode,
                "thread_cwd": str(scenario_cwd),
                "app_server_command": app.proc.args,
                "listen_url": app.listen_url,
                "codex_home": str(hook_context.codex_home),
                "hook_capture_log": str(hook_context.hook_log_path),
                "process": process_info,
                "startup_failed": True,
                "messages": [],
                "message_summary": summarize_messages([]),
                "assertions": [
                    assertion(
                        "app-server-listen",
                        False,
                        "App-server never reached the loopback websocket listen state.",
                    )
                ],
            }
            output_path = output_dir / scenario.output_name
            write_json(output_path, artifact)
            return output_path

        first_connection_messages: list[dict[str, Any]] = []
        second_connection_messages: list[dict[str, Any]] = []
        first_init_response: dict[str, Any] = {}
        second_init_response: dict[str, Any] = {}
        thread_start_response: dict[str, Any] = {}
        thread_resume_response: dict[str, Any] = {}
        thread_resume_attempts: list[dict[str, Any]] = []
        turn_result = TurnRunResult(start_response={}, messages=[])
        thread_read_response: dict[str, Any] = {}
        process_info: dict[str, Any]
        thread_id: str | None = None
        thread_path: str | None = None

        ws = WebSocketClient(app.listen_url)
        try:
            ws.connect()
            init_messages, first_init_response = initialize_client(ws)
            first_connection_messages.extend(init_messages)
            thread_start_response, thread_messages = start_thread(ws, scenario_cwd, model)
            first_connection_messages.extend(thread_messages)
            thread_id = thread_start_response.get("result", {}).get("thread", {}).get("id")
            thread_path = thread_start_response.get("result", {}).get("thread", {}).get("path")
            if not thread_id:
                raise RuntimeError(f"Missing thread id for scenario {scenario.slug}")
        finally:
            ws.close()

        ws = WebSocketClient(app.listen_url)
        try:
            ws.connect()
            init_messages, second_init_response = initialize_client(ws)
            second_connection_messages.extend(init_messages)
            thread_resume_response, resume_messages = resume_thread(
                ws,
                thread_id,
                scenario_cwd,
                model,
                request_id="thread-resume-by-id",
            )
            second_connection_messages.extend(resume_messages)
            thread_resume_attempts.append(
                {
                    "strategy": "thread_id",
                    "response": thread_resume_response,
                }
            )
            if "error" in thread_resume_response and thread_path:
                thread_resume_response, resume_messages = resume_thread(
                    ws,
                    thread_id,
                    scenario_cwd,
                    model,
                    thread_path=thread_path,
                    request_id="thread-resume-by-path",
                )
                second_connection_messages.extend(resume_messages)
                thread_resume_attempts.append(
                    {
                        "strategy": "thread_id_plus_path",
                        "path": thread_path,
                        "response": thread_resume_response,
                    }
                )
            turn_result = run_turn(ws, thread_id, scenario, model)
            second_connection_messages.extend(turn_result.messages)
            thread_read_response, thread_read_messages = read_thread(ws, thread_id)
            second_connection_messages.extend(thread_read_messages)
        finally:
            ws.close()
            process_info = app.terminate()

        all_messages = first_connection_messages + second_connection_messages
        hook_artifacts = read_hook_artifacts(hook_context.hook_log_path)
        assertions = evaluate_scenario(
            scenario=scenario,
            thread_response=thread_resume_response,
            turn_result=turn_result,
            messages=all_messages,
            extra={
                "hook_artifacts": hook_artifacts,
                "initial_thread_start_response": thread_start_response,
                "thread_resume_response": thread_resume_response,
                "thread_resume_attempts": thread_resume_attempts,
                "thread_read_response": thread_read_response,
                "original_thread_id": thread_id,
            },
        )
        artifact = {
            "scenario": scenario.slug,
            "description": scenario.description,
            "prompt": scenario.prompt,
            "required_features": list(scenario.required_features),
            "app_server_config_overrides": list(scenario.app_server_config_overrides),
            "app_server_command": app.proc.args,
            "listen_url": app.listen_url,
            "workspace_cwd": str(scenario_cwd),
            "codex_home": str(hook_context.codex_home),
            "hook_capture_log": str(hook_context.hook_log_path),
            "hook_capture_script": str(hook_context.hook_script_path),
            "hook_artifacts": hook_artifacts,
            "process": process_info,
            "first_initialize_response": first_init_response,
            "initial_thread_start_response": thread_start_response,
            "second_initialize_response": second_init_response,
            "thread_resume_response": thread_resume_response,
            "thread_resume_attempts": thread_resume_attempts,
            "resumed_turn_start_response": turn_result.start_response,
            "thread_read_response": thread_read_response,
            "first_connection_messages": first_connection_messages,
            "second_connection_messages": second_connection_messages,
            "messages": all_messages,
            "message_summary": summarize_messages(all_messages),
            "assertions": assertions,
        }
        output_path = output_dir / scenario.output_name
        write_json(output_path, artifact)
        return output_path


def collect_notification_methods(messages: list[dict[str, Any]]) -> list[str]:
    return sorted(
        {
            method
            for method in (
                message.get("method")
                for message in messages
                if isinstance(message.get("method"), str)
            )
        }
    )


def collect_item_types(messages: list[dict[str, Any]]) -> list[str]:
    item_types: set[str] = set()
    for message in messages:
        item = message.get("params", {}).get("item")
        if isinstance(item, dict):
            item_type = item.get("type")
            if isinstance(item_type, str):
                item_types.add(item_type)
    return sorted(item_types)


def collect_command_execution_items(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for message in messages:
        item = message.get("params", {}).get("item")
        if isinstance(item, dict) and item.get("type") == "commandExecution":
            items.append(item)
    return items


def collect_completed_agent_message_texts(messages: list[dict[str, Any]]) -> list[str]:
    texts: list[str] = []
    for message in messages:
        if message.get("method") != "item/completed":
            continue
        item = message.get("params", {}).get("item")
        if isinstance(item, dict) and item.get("type") == "agentMessage":
            text = item.get("text")
            if isinstance(text, str):
                texts.append(text)
    return texts


def collect_thread_statuses(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    statuses: list[dict[str, Any]] = []
    for message in messages:
        if message.get("method") == "thread/status/changed":
            status = message.get("params", {}).get("status")
            if isinstance(status, dict):
                statuses.append(status)
    return statuses


SEARCH_EXCLUDED_KEYS = {
    "aggregatedOutput",
    "command",
    "description",
    "input",
    "prompt",
    "text",
}


def sanitize_for_structured_search(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: sanitize_for_structured_search(child)
            for key, child in value.items()
            if key not in SEARCH_EXCLUDED_KEYS
        }
    if isinstance(value, list):
        return [sanitize_for_structured_search(item) for item in value]
    return value


def find_structured_matches(
    messages: list[dict[str, Any]],
    keywords: tuple[str, ...],
    *,
    methods: set[str] | None = None,
) -> list[dict[str, Any]]:
    lowered = tuple(keyword.lower() for keyword in keywords)
    matches: list[dict[str, Any]] = []
    for message in messages:
        if methods is not None and message.get("method") not in methods:
            continue
        haystack = json.dumps(
            sanitize_for_structured_search(message),
            ensure_ascii=False,
        ).lower()
        if all(keyword in haystack for keyword in lowered):
            matches.append(message)
    return matches


def find_matching_messages(messages: list[dict[str, Any]], needle: str) -> list[dict[str, Any]]:
    lowered = needle.lower()
    matches: list[dict[str, Any]] = []
    for message in messages:
        if lowered in json.dumps(message, ensure_ascii=False).lower():
            matches.append(message)
    return matches


def assertion(name: str, passed: bool, details: str) -> dict[str, Any]:
    return {"name": name, "passed": passed, "details": details}


def summarize_messages(messages: list[dict[str, Any]]) -> dict[str, Any]:
    command_items = collect_command_execution_items(messages)
    return {
        "notification_methods": collect_notification_methods(messages),
        "item_types": collect_item_types(messages),
        "completed_agent_messages": collect_completed_agent_message_texts(messages),
        "thread_statuses": collect_thread_statuses(messages),
        "command_execution_count": len(command_items),
        "command_execution_exit_codes": [
            item.get("exitCode") for item in command_items if "exitCode" in item
        ],
        "turn_completed": any(message.get("method") == "turn/completed" for message in messages),
        "error_notifications": len(
            [message for message in messages if message.get("method") == "error"]
        ),
    }


def evaluate_scenario(
    scenario: Scenario,
    thread_response: dict[str, Any],
    turn_result: TurnRunResult,
    messages: list[dict[str, Any]],
    extra: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    assertions: list[dict[str, Any]] = []
    extra = extra or {}
    thread_result = thread_response.get("result", {})
    approval_policy = thread_result.get("approvalPolicy")
    turn_response = turn_result.start_response
    item_types = collect_item_types(messages)
    command_items = collect_command_execution_items(messages)
    thread_statuses = collect_thread_statuses(messages)
    hook_artifacts = extra.get("hook_artifacts", [])
    turn_completed = any(message.get("method") == "turn/completed" for message in messages)

    assertions.append(
        assertion(
            "turn-start-response",
            "result" in turn_response and bool(turn_response.get("result", {}).get("turn")),
            "turn/start returned a turn result payload.",
        )
    )
    if scenario.slug not in {"approval-wait", "explicit-user-input-wait"}:
        expected_hook_capture = scenario.slug in {
            "failed-tool-command-execution",
            "successful-turn-steer",
        }
        assertions.append(
            assertion(
                "hook-artifact-captured",
                (not expected_hook_capture) or bool(hook_artifacts),
                "Expected a tool hook artifact from the isolated CODEX_HOME capture path.",
            )
        )

    if scenario.slug == "approval-wait":
        approval_matches = find_structured_matches(
            messages,
            ("approval",),
            methods={"thread/status/changed", "turn/started", "turn/completed"},
        )
        blocked_statuses = [
            status
            for status in thread_statuses
            if status.get("type") not in {"active", "idle"} or bool(status.get("activeFlags"))
        ]
        assertions.append(
            assertion(
                "approval-policy-compatible",
                approval_policy in {"on-request", "untrusted"},
                f"thread/start approvalPolicy={approval_policy!r}.",
            )
        )
        assertions.append(
            assertion(
                "approval-wait-structured-evidence",
                bool(approval_matches) or bool(blocked_statuses),
                "Expected structured approval-blocked evidence in notifications or thread status fields.",
            )
        )
        assertions.append(
            assertion(
                "turn-left-pending-or-blocked",
                not turn_completed,
                "Expected the turn to wait for approval instead of completing cleanly.",
            )
        )
    elif scenario.slug == "explicit-user-input-wait":
        completed_agent_messages = collect_completed_agent_message_texts(messages)
        final_text = completed_agent_messages[-1] if completed_agent_messages else ""
        wait_matches = find_structured_matches(
            messages,
            ("input",),
            methods={"thread/status/changed", "turn/started", "turn/completed"},
        )
        blocked_statuses = [
            status
            for status in thread_statuses
            if status.get("type") not in {"active", "idle"} or bool(status.get("activeFlags"))
        ]
        assertions.append(
            assertion(
                "assistant-asked-question",
                final_text.strip().endswith("?"),
                "Expected the completed assistant message to end with a clarifying question.",
            )
        )
        assertions.append(
            assertion(
                "input-wait-structured-evidence",
                bool(wait_matches) or bool(blocked_statuses),
                "Expected structured wait-state evidence rather than only prompt or prose echoes.",
            )
        )
        assertions.append(
            assertion(
                "turn-left-pending-for-input",
                not turn_completed,
                "Expected the turn to remain pending for explicit user input.",
            )
        )
    elif scenario.slug == "failed-tool-command-execution":
        failed_items = [
            item for item in command_items if item.get("exitCode") not in (None, 0)
        ]
        command_matches = find_matching_messages(
            messages, "definitely-not-a-real-command-pi-shmits-angels"
        )
        assertions.append(
            assertion(
                "command-execution-item-present",
                "commandExecution" in item_types,
                "Expected the failing command to surface as a commandExecution item.",
            )
        )
        assertions.append(
            assertion(
                "non-zero-exit-code-observed",
                bool(failed_items),
                "Expected at least one commandExecution item with a non-zero exitCode.",
            )
        )
        assertions.append(
            assertion(
                "failing-command-string-preserved",
                bool(command_matches),
                "Expected the exact failing command string to appear in captured traffic.",
            )
        )
    elif scenario.slug == "successful-turn-steer":
        initial_turn_id = turn_response.get("result", {}).get("turn", {}).get("id")
        steer_response = turn_result.steer_response or {}
        steer_turn_id = steer_response.get("result", {}).get("turnId")
        completed_agent_messages = collect_completed_agent_message_texts(messages)
        final_text = completed_agent_messages[-1] if completed_agent_messages else ""
        command_started = any(
            message.get("method") == "item/started"
            and message_item_type(message) == "commandExecution"
            for message in messages
        )
        assertions.append(
            assertion(
                "steer-request-sent-before-completion",
                turn_result.steer_sent and not turn_result.steer_completed_before_send,
                "Expected the harness to send turn/steer while the original turn was still active.",
            )
        )
        assertions.append(
            assertion(
                "steer-response-returned-turn-id",
                isinstance(steer_turn_id, str) and bool(steer_turn_id),
                "Expected turn/steer to return a result.turnId value.",
            )
        )
        assertions.append(
            assertion(
                "steer-target-matched-active-turn",
                isinstance(initial_turn_id, str) and steer_turn_id == initial_turn_id,
                "Expected turn/steer to acknowledge the same active turn id returned by turn/start.",
            )
        )
        assertions.append(
            assertion(
                "steer-window-included-command-execution",
                command_started,
                "Expected the long-running commandExecution item to open a practical mid-turn steer window.",
            )
        )
        assertions.append(
            assertion(
                "final-answer-reflects-steer",
                "STEERED-RESULT" in final_text and "ORIGINAL-RESULT" not in final_text,
                "Expected the completed agentMessage text to reflect the steered instruction.",
            )
        )
    elif scenario.slug == "thread-resume-turn-start":
        original_thread_id = extra.get("original_thread_id")
        resumed_thread_id = thread_response.get("result", {}).get("thread", {}).get("id")
        thread_resume_attempts = extra.get("thread_resume_attempts", [])
        thread_read_response = extra.get("thread_read_response", {})
        thread_read_thread = thread_read_response.get("result", {}).get("thread", {})
        thread_read_turns = thread_read_thread.get("turns", [])
        completed_agent_messages = collect_completed_agent_message_texts(messages)
        final_text = completed_agent_messages[-1] if completed_agent_messages else ""
        if not final_text and thread_read_turns:
            final_text = json.dumps(thread_read_turns[-1], ensure_ascii=False)
        resume_strategy = "unknown"
        if thread_resume_attempts:
            resume_strategy = thread_resume_attempts[-1].get("strategy", "unknown")
        live_turn_completed = any(message.get("method") == "turn/completed" for message in messages)
        stored_turn_completed = any(
            isinstance(turn, dict) and turn.get("status") == "completed"
            for turn in thread_read_turns
        )
        assertions.append(
            assertion(
                "thread-resume-returned-same-thread-id",
                isinstance(original_thread_id, str) and resumed_thread_id == original_thread_id,
                f"Expected thread/resume to reattach to the original thread id; final resume strategy was {resume_strategy}.",
            )
        )
        assertions.append(
            assertion(
                "resumed-turn-completed",
                live_turn_completed or stored_turn_completed,
                "Expected the resumed thread turn to complete on the second connection or in persisted turn history.",
            )
        )
        assertions.append(
            assertion(
                "final-answer-reflects-resumed-turn",
                "RESUMED-THREAD-RESULT" in final_text,
                "Expected the completed agentMessage text from the resumed turn to match the prompt.",
            )
        )
        assertions.append(
            assertion(
                "thread-read-returned-turn-history",
                isinstance(thread_read_turns, list) and len(thread_read_turns) >= 1,
                "Expected thread/read includeTurns=true after resume to return at least one turn.",
            )
        )
        assertions.append(
            assertion(
                "thread-read-preserved-resumed-agent-message",
                "RESUMED-THREAD-RESULT"
                in json.dumps(thread_read_response, ensure_ascii=False),
                "Expected thread/read output to preserve the resumed delivery in stored turn history.",
            )
        )
    elif scenario.slug == "web-search-fetch":
        web_item_present = any(
            "web" in item_type.lower() or "search" in item_type.lower()
            for item_type in item_types
        )
        web_search_enabled = any(
            override.startswith("web_search=")
            for override in scenario.app_server_config_overrides
        ) or "search" in scenario.required_features
        assertions.append(
            assertion(
                "search-feature-enabled",
                web_search_enabled,
                "App-server launch for this scenario enabled a web search mode.",
            )
        )
        assertions.append(
            assertion(
                "non-shell-web-shape-observed",
                web_item_present,
                "Expected a distinct structured web/search item type rather than only shell commandExecution or text references.",
            )
        )
    else:
        raise ValueError(f"Unhandled scenario: {scenario.slug}")

    return assertions


def run_scenario(
    scenario: Scenario,
    output_dir: Path,
    cwd: Path,
    model: str,
    codex_home: Path | None,
) -> Path:
    workspace_root = output_dir / ".scenario-workspaces"
    workspace_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f"{scenario.slug}-",
        dir=workspace_root,
    ) as temp_dir:
        temp_root = Path(temp_dir)
        scenario_cwd = cwd if scenario.thread_cwd_mode == "repo" else temp_root
        hook_context = build_capture_codex_home(
            temp_root / "codex-home",
            resolve_source_codex_home(codex_home),
            [cwd, scenario_cwd],
        )
        app = start_app_server(
            cwd,
            model,
            scenario.required_features,
            scenario.app_server_config_overrides,
            hook_context.codex_home,
            bypass_hook_trust=True,
        )
        if not app.wait_for_listen(timeout=20.0):
            process_info = app.terminate()
            artifact = {
                "scenario": scenario.slug,
                "description": scenario.description,
                "prompt": scenario.prompt,
                "required_features": list(scenario.required_features),
                "app_server_config_overrides": list(scenario.app_server_config_overrides),
                "thread_cwd_mode": scenario.thread_cwd_mode,
                "thread_cwd": str(scenario_cwd),
                "app_server_command": app.proc.args,
                "listen_url": app.listen_url,
                "codex_home": str(hook_context.codex_home),
                "hook_capture_log": str(hook_context.hook_log_path),
                "process": process_info,
                "startup_failed": True,
                "messages": [],
                "message_summary": summarize_messages([]),
                "assertions": [
                    assertion(
                        "app-server-listen",
                        False,
                        "App-server never reached the loopback websocket listen state.",
                    )
                ],
            }
            output_path = output_dir / scenario.output_name
            write_json(output_path, artifact)
            return output_path

        ws = WebSocketClient(app.listen_url)
        try:
            ws.connect()
            bootstrap_messages, init_response, thread_response = initialize_session(
                ws, scenario, scenario_cwd, model
            )
            thread_id = (
                thread_response.get("result", {}).get("thread", {}).get("id")
                if thread_response
                else None
            )
            if not thread_id:
                raise RuntimeError(f"Missing thread id for scenario {scenario.slug}")
            turn_result = run_turn(ws, thread_id, scenario, model)
            all_messages = bootstrap_messages + turn_result.messages
        finally:
            ws.close()
            process_info = app.terminate()
        hook_artifacts = read_hook_artifacts(hook_context.hook_log_path)

        assertions = evaluate_scenario(
            scenario=scenario,
            thread_response=thread_response,
            turn_result=turn_result,
            messages=all_messages,
            extra={"hook_artifacts": hook_artifacts},
        )
        artifact = {
            "scenario": scenario.slug,
            "description": scenario.description,
            "prompt": scenario.prompt,
            "required_features": list(scenario.required_features),
            "app_server_config_overrides": list(scenario.app_server_config_overrides),
            "thread_cwd_mode": scenario.thread_cwd_mode,
            "app_server_command": app.proc.args,
            "listen_url": app.listen_url,
            "workspace_cwd": str(scenario_cwd),
            "codex_home": str(hook_context.codex_home),
            "hook_capture_log": str(hook_context.hook_log_path),
            "hook_capture_script": str(hook_context.hook_script_path),
            "hook_artifacts": hook_artifacts,
            "process": process_info,
            "initialize_response": init_response,
            "thread_start_response": thread_response,
            "turn_start_response": turn_result.start_response,
            "steer_request": turn_result.steer_request,
            "steer_response": turn_result.steer_response,
            "steer_sent": turn_result.steer_sent,
            "steer_completed_before_send": turn_result.steer_completed_before_send,
            "steer_triggered_by": turn_result.steer_triggered_by,
            "messages": all_messages,
            "message_summary": summarize_messages(all_messages),
            "assertions": assertions,
        }
        output_path = output_dir / scenario.output_name
        write_json(output_path, artifact)
        return output_path


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    scenarios = args.scenario or list(DEFAULT_SCENARIOS)
    written: list[Path] = []
    for slug in scenarios:
        scenario = SCENARIOS[slug]
        if slug == "thread-resume-turn-start":
            written.append(
                run_resume_scenario(
                    scenario=scenario,
                    output_dir=args.output_dir,
                    cwd=args.cwd.resolve(),
                    model=DEFAULT_MODEL,
                    codex_home=args.codex_home.resolve() if args.codex_home else None,
                )
            )
        else:
            written.append(
                run_scenario(
                    scenario=scenario,
                    output_dir=args.output_dir,
                    cwd=args.cwd.resolve(),
                    model=DEFAULT_MODEL,
                    codex_home=args.codex_home.resolve() if args.codex_home else None,
                )
            )
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
