#!/usr/bin/env python3
"""
Capture launch-time configuration errors and SessionStart hook failures from
Codex app-server in isolated CODEX_HOME sandboxes.

This harness covers the "configuration and harness error/warning notifications"
evidence gap for pi-shmits-angels without relying on remote-endpoint faults.
Each scenario writes one JSON artifact that preserves the raw JSON-RPC traffic
when available plus the app-server process stderr/stdout needed to explain
startup failures that never reach websocket transport.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_OUTPUT_DIR = Path("/tmp/pi-shmits-angels-codex-app-server-errors")
DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_SANDBOX_ROOT = Path("/tmp/pi-shmits-angels-codex-app-server-evidence")
DEFAULT_SOURCE_CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))


class WebSocketClient:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.sock: socket.socket | None = None
        self._recv_buf = b""
        self._send_lock = threading.Lock()

    def connect(self, timeout: float = 15.0) -> None:
        parsed = urlparse(self.endpoint)
        if parsed.scheme == "unix":
            target = parsed.path or parsed.netloc
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(timeout)
            self.sock.connect(target)
        elif parsed.scheme == "ws":
            host = parsed.hostname or "127.0.0.1"
            port = parsed.port
            if port is None:
                raise ValueError(f"Missing port in websocket endpoint: {self.endpoint}")
            self.sock = socket.create_connection((host, port), timeout=timeout)
            self.sock.settimeout(timeout)
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
        max_messages: int = 500,
    ) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        deadline = time.monotonic() + total_timeout
        last_message_at = time.monotonic()
        while time.monotonic() < deadline and len(messages) < max_messages:
            msg = self.recv_json(timeout=min(1.0, deadline - time.monotonic()))
            if msg is None:
                if messages and time.monotonic() - last_message_at >= quiet_period:
                    break
                continue
            messages.append(msg)
            last_message_at = time.monotonic()
            if stop_methods and msg.get("method") in stop_methods:
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
    def __init__(self, stream):
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


@dataclass
class AppServerProcess:
    proc: subprocess.Popen[str]
    stdout: StreamCollector
    stderr: StreamCollector
    listen_url: str

    def wait_for_listen(self, timeout: float = 20.0) -> bool:
        if self.listen_url.startswith("unix://"):
            socket_path = Path(self.listen_url.removeprefix("unix://"))
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if socket_path.exists():
                    return True
                if self.proc.poll() is not None:
                    return False
                time.sleep(0.2)
            return socket_path.exists()

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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Capture launch-time configuration errors and SessionStart hook "
            "failures from Codex app-server in isolated temp CODEX_HOME roots."
        )
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for JSON artifacts (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--sandbox-root",
        type=Path,
        default=DEFAULT_SANDBOX_ROOT,
        help=(
            "Parent directory for temporary isolated CODEX_HOME sandboxes "
            f"(default: {DEFAULT_SANDBOX_ROOT})"
        ),
    )
    parser.add_argument(
        "--prompt",
        default="Reply with exactly HOOK-FAILURE-CAPTURE and nothing else.",
        help="Prompt used for the hook-failure turn.",
    )
    parser.add_argument(
        "--hook-listen-transport",
        choices=("ws", "unix"),
        default="ws",
        help="Transport to use for the SessionStart hook scenario (default: ws).",
    )
    parser.add_argument(
        "--app-server-config-override",
        action="append",
        default=[],
        help=(
            "Additional raw -c key=value overrides to pass through to codex "
            "app-server for experiment runs. Repeatable."
        ),
    )
    parser.add_argument(
        "--skip-config-error",
        action="store_true",
        help="Do not run the launch-time configuration error scenario.",
    )
    parser.add_argument(
        "--skip-hook-failure",
        action="store_true",
        help="Do not run the SessionStart hook failure scenario.",
    )
    return parser.parse_args()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def summarize_rpc_messages(rpc_messages: list[dict[str, Any]]) -> dict[str, Any]:
    notification_methods: list[str] = []
    error_response_ids: list[str] = []
    result_response_ids: list[str] = []
    for message in rpc_messages:
        if "method" in message:
            method = message["method"]
            if isinstance(method, str):
                notification_methods.append(method)
        elif "error" in message:
            error_response_ids.append(str(message.get("id", "")))
        elif "result" in message:
            result_response_ids.append(str(message.get("id", "")))
    dedicated_error_warning_methods = sorted(
        {
            method
            for method in notification_methods
            if "error" in method.lower() or "warning" in method.lower()
        }
    )
    return {
        "transport_reached": bool(rpc_messages),
        "notification_methods": sorted(set(notification_methods)),
        "error_response_ids": error_response_ids,
        "result_response_ids": result_response_ids,
        "dedicated_error_warning_notification_methods": dedicated_error_warning_methods,
    }


def reserve_loopback_ws_url() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"ws://127.0.0.1:{port}"


def resolve_config_overrides(overrides: list[str], listen_url: str, socket_path: Path) -> list[str]:
    resolved: list[str] = []
    for override in overrides:
        resolved.append(
            override
            .replace("{{listen_url}}", listen_url)
            .replace("{{socket_path}}", str(socket_path))
        )
    return resolved


def start_app_server(
    codex_home: Path,
    socket_path: Path,
    *,
    model: str,
    cwd: Path,
    config_overrides: list[str] | None = None,
    bypass_hook_trust: bool = False,
    strict_config: bool = False,
) -> AppServerProcess:
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    if socket_path.exists():
        socket_path.unlink()
    listen_url = reserve_loopback_ws_url() if socket_path.name.endswith(".ws") else f"unix://{socket_path}"
    resolved_overrides = resolve_config_overrides(config_overrides or [], listen_url, socket_path)
    command = ["codex"]
    if bypass_hook_trust:
        command.append("--dangerously-bypass-hook-trust")
    command.extend(["app-server"])
    if strict_config:
        command.append("--strict-config")
    command.extend(
        [
            "--listen",
            listen_url,
            "-c",
            f"model={json.dumps(model)}",
        ]
    )
    for override in resolved_overrides:
        command.extend(["-c", override])
    env = os.environ.copy()
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


def trusted_project_config(base: Path) -> str:
    lines: list[str] = []
    for candidate in [base, *base.parents]:
        if (candidate / ".codex").is_dir():
            lines.extend(
                [
                    f'[projects.{json.dumps(str(candidate))}]',
                    'trust_level = "trusted"',
                    "",
                ]
            )
    return "\n".join(lines)


def resolve_source_codex_home(codex_home: Path | None) -> Path | None:
    candidate = codex_home or DEFAULT_SOURCE_CODEX_HOME
    return candidate if candidate.is_dir() else None


def copy_auth_material(base: Path, source_codex_home: Path | None) -> None:
    if source_codex_home is None:
        return
    for filename in ("auth.json", "installation_id"):
        source = source_codex_home / filename
        if source.is_file():
            shutil.copy2(source, base / filename)


def build_hook_failure_home(
    base: Path,
    failing_hook: Path,
    source_codex_home: Path | None,
) -> None:
    copy_auth_material(base, source_codex_home)
    trusted_projects = trusted_project_config(base)
    config_toml = '\n'.join(
        [
            f"model = {json.dumps(DEFAULT_MODEL)}",
            "[features]",
            "hooks = true",
            "",
            trusted_projects,
        ]
    )
    (base / "config.toml").write_text(config_toml, encoding="utf-8")
    hooks_json = {
        "hooks": {
            "SessionStart": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"bash {json.dumps(str(failing_hook))}",
                            "timeout": 10,
                        }
                    ]
                }
            ]
        }
    }
    (base / "hooks.json").write_text(json.dumps(hooks_json, indent=2), encoding="utf-8")


def build_bad_config_home(base: Path) -> None:
    copy_auth_material(base, resolve_source_codex_home(None))
    trusted_projects = trusted_project_config(base)
    config_toml = '\n'.join(
        [
            f"model = {json.dumps(DEFAULT_MODEL)}",
            "unsupported_launch_key = true",
            "",
            trusted_projects,
        ]
    )
    (base / "config.toml").write_text(config_toml, encoding="utf-8")


def make_socket_path(label: str) -> Path:
    token = uuid.uuid4().hex[:10]
    return Path("/tmp") / f"pi-shmits-angels-{label}-{token}.sock"


def make_ws_stub(label: str) -> Path:
    token = uuid.uuid4().hex[:10]
    return Path("/tmp") / f"pi-shmits-angels-{label}-{token}.ws"


def run_config_error_scenario(output_dir: Path, sandbox_root: Path) -> Path:
    sandbox_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="codex-app-server-config-error-",
        dir=sandbox_root,
    ) as temp_dir:
        sandbox = Path(temp_dir)
        build_bad_config_home(sandbox)
        socket_path = make_socket_path("config")
        app = start_app_server(
            sandbox,
            socket_path,
            model=DEFAULT_MODEL,
            cwd=sandbox,
            config_overrides=[],
            strict_config=True,
        )
        app.proc.wait(timeout=15.0)
        process_info = app.terminate()
        artifact = {
            "scenario": "launch_time_config_error",
            "scope_note": (
                "Remote endpoint faults are intentionally out of scope. This "
                "scenario checks a local launch-time configuration error only."
            ),
            "evidence_basis": "startup_failure_before_transport",
            "command": app.proc.args,
            "codex_home": str(sandbox),
            "listen_url": app.listen_url,
            "socket_path": str(socket_path),
            "socket_created": socket_path.exists(),
            "process": process_info,
            "rpc_messages": [],
            "rpc_summary": summarize_rpc_messages([]),
        }
        output_path = output_dir / "launch_time_config_error.json"
        write_json(output_path, artifact)
        return output_path


def run_hook_failure_scenario(
    output_dir: Path,
    sandbox_root: Path,
    prompt: str,
    listen_transport: str,
    config_overrides: list[str],
) -> Path:
    sandbox_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="codex-app-server-hook-failure-",
        dir=sandbox_root,
    ) as temp_dir:
        sandbox = Path(temp_dir)
        failing_hook = sandbox / "failing-session-start-hook.sh"
        failing_hook.write_text(
            "#!/usr/bin/env bash\n"
            "echo 'pi-shmits-angels intentional SessionStart hook failure' >&2\n"
            "exit 23\n",
            encoding="utf-8",
        )
        failing_hook.chmod(0o755)
        build_hook_failure_home(
            sandbox,
            failing_hook,
            resolve_source_codex_home(None),
        )
        socket_path = (
            make_ws_stub("hook")
            if listen_transport == "ws"
            else make_socket_path("hook")
        )
        resolved_overrides = resolve_config_overrides(config_overrides, f"unix://{socket_path}" if listen_transport == "unix" else "", socket_path)
        app = start_app_server(
            sandbox,
            socket_path,
            model=DEFAULT_MODEL,
            cwd=sandbox,
            config_overrides=config_overrides,
            bypass_hook_trust=True,
        )
        if not app.wait_for_listen(timeout=20.0):
            process_info = app.terminate()
            artifact = {
                "scenario": "session_start_hook_failure",
                "scope_note": (
                    "Remote endpoint faults are intentionally out of scope. "
                    "This scenario checks an isolated local hook failure."
                ),
                "evidence_basis": "startup_failure_before_transport",
                "command": app.proc.args,
                "codex_home": str(sandbox),
                "listen_url": app.listen_url,
                "socket_path": str(socket_path),
                "requested_transport": listen_transport,
                "config_overrides": resolved_overrides,
                "hook_script": str(failing_hook),
                "startup_failed": True,
                "process": process_info,
                "rpc_messages": [],
                "rpc_summary": summarize_rpc_messages([]),
            }
            output_path = output_dir / "session_start_hook_failure.json"
            write_json(output_path, artifact)
            return output_path

        ws = WebSocketClient(app.listen_url)
        rpc_messages: list[dict[str, Any]] = []
        try:
            ws.connect()
            rpc_messages.extend(ws.recv_until_quiet(total_timeout=1.0, quiet_period=0.5))

            initialize_request = {
                "jsonrpc": "2.0",
                "id": "init",
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "pi-shmits-angels-config-hook-capture",
                        "version": "0.1.0",
                    }
                },
            }
            ws.send_json(initialize_request)
            init_response = ws.recv_json(timeout=10.0)
            if init_response is not None:
                rpc_messages.append(init_response)
            ws.send_json({"jsonrpc": "2.0", "method": "initialized"})
            rpc_messages.extend(ws.recv_until_quiet(total_timeout=2.0, quiet_period=0.75))

            ws.send_json(
                {
                    "jsonrpc": "2.0",
                    "id": "thread-start",
                        "method": "thread/start",
                        "params": {
                            "model": DEFAULT_MODEL,
                            "cwd": str(sandbox),
                        },
                    }
                )
            thread_start_response = ws.recv_json(timeout=15.0)
            if thread_start_response is not None:
                rpc_messages.append(thread_start_response)
            rpc_messages.extend(ws.recv_until_quiet(total_timeout=4.0, quiet_period=1.0))
            thread_id = (
                (thread_start_response or {})
                .get("result", {})
                .get("thread", {})
                .get("id")
            )

            if thread_id:
                ws.send_json(
                    {
                        "jsonrpc": "2.0",
                        "id": "turn-start",
                        "method": "turn/start",
                        "params": {
                            "threadId": thread_id,
                            "input": [{"type": "text", "text": prompt}],
                            "model": DEFAULT_MODEL,
                        },
                    }
                )
                turn_start_response = ws.recv_json(timeout=30.0)
                if turn_start_response is not None:
                    rpc_messages.append(turn_start_response)
                rpc_messages.extend(
                    ws.recv_until_quiet(
                        total_timeout=90.0,
                        quiet_period=2.0,
                        stop_methods={"turn/completed"},
                    )
                )
        finally:
            ws.close()
            process_info = app.terminate()

        artifact = {
            "scenario": "session_start_hook_failure",
            "scope_note": (
                "Remote endpoint faults are intentionally out of scope. "
                "This scenario checks an isolated local hook failure."
            ),
            "evidence_basis": (
                "websocket_transport"
                if rpc_messages
                else "startup_or_transport_failure_without_messages"
            ),
            "command": app.proc.args,
            "codex_home": str(sandbox),
            "listen_url": app.listen_url,
            "socket_path": str(socket_path),
            "requested_transport": listen_transport,
            "config_overrides": resolved_overrides,
            "hook_script": str(failing_hook),
            "hook_expected_exit_code": 23,
            "process": process_info,
            "rpc_messages": rpc_messages,
            "rpc_summary": summarize_rpc_messages(rpc_messages),
        }
        output_path = output_dir / "session_start_hook_failure.json"
        write_json(output_path, artifact)
        return output_path


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.sandbox_root.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    if not args.skip_config_error:
        written.append(run_config_error_scenario(args.output_dir, args.sandbox_root))
    if not args.skip_hook_failure:
        written.append(
            run_hook_failure_scenario(
                args.output_dir,
                args.sandbox_root,
                args.prompt,
                args.hook_listen_transport,
                args.app_server_config_override,
            )
        )
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
