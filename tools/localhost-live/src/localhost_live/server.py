"""Stdlib HTTP server lifecycle and discovery helpers."""

from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import os
import queue
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any
from urllib.parse import unquote, urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from localhost_live.importer import ImportRejectedError
from localhost_live.jsonio import atomic_write_json, read_json
from localhost_live.metadata import build_server_metadata
from localhost_live.registry import SessionNotFoundError, SessionRegistry
from localhost_live.runtime import (
    control_token_path,
    ensure_control_token,
    resolve_runtime_root,
    server_metadata_path,
)


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 0
DEFAULT_IDLE_TIMEOUT_SECONDS = 300
SSE_HEARTBEAT_SECONDS = 1.0
_SSE_CLOSE_SENTINEL = "__localhost-live:sse-close__"
_SECRET_MARKERS = (
    "secret",
    "token",
    "password",
    "passwd",
    "credential",
    "private",
    "apikey",
    "api_key",
)
_TRUSTED_SHELL_CSP = (
    "default-src 'none'; "
    "style-src 'self'; "
    "script-src 'self'; "
    "img-src 'self' data:; "
    "frame-src 'self'; "
    "connect-src 'self'; "
    "base-uri 'none'; "
    "form-action 'none'; "
    "frame-ancestors 'none'"
)
_VENDOR_ROUTE_PREFIX = "/assets/vendor/"


class ServerUnavailableError(RuntimeError):
    """Raised when no healthy server is available and startup is disabled/fails."""


class _ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class _LocalhostLiveHTTPServer(_ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        runtime_root: Path,
        idle_timeout_seconds: int,
    ) -> None:
        super().__init__(server_address, _HealthHandler)
        self.runtime_root = runtime_root
        self.registry = SessionRegistry(runtime_root=runtime_root)
        self.control_token = ensure_control_token(runtime_root)
        self.idle_timeout_seconds = idle_timeout_seconds
        self._sse_lock = threading.Lock()
        self._sse_subscribers: dict[str, set[queue.Queue[str]]] = {}
        self._lifecycle_lock = threading.Lock()
        self._last_update_monotonic = time.monotonic()
        self._active_mutation_count = 0
        self._shutdown_requested = False

    def subscribe_events(self, session_id: str) -> queue.Queue[str]:
        subscriber: queue.Queue[str] = queue.Queue(maxsize=128)
        with self._sse_lock:
            self._sse_subscribers.setdefault(session_id, set()).add(subscriber)
        return subscriber

    def unsubscribe_events(self, session_id: str, subscriber: queue.Queue[str]) -> None:
        with self._sse_lock:
            subscribers = self._sse_subscribers.get(session_id)
            if not subscribers:
                return
            subscribers.discard(subscriber)
            if not subscribers:
                self._sse_subscribers.pop(session_id, None)

    def publish_state_added(self, session_id: str, state_payload: dict[str, Any]) -> None:
        message = _format_sse_event(
            "state-added",
            state_payload,
            event_id=str(state_payload.get("sequence", "")),
        )
        with self._sse_lock:
            subscribers = list(self._sse_subscribers.get(session_id, set()))
        for subscriber in subscribers:
            self._enqueue_sse_message(subscriber, message)

    def begin_mutation_activity(self) -> str:
        touched_at = _utc_now()
        with self._lifecycle_lock:
            self._active_mutation_count += 1
            self._last_update_monotonic = time.monotonic()
            self._update_server_metadata_locked(last_mutation_at=touched_at)
        return touched_at

    def complete_mutation_activity(self) -> str:
        touched_at = _utc_now()
        with self._lifecycle_lock:
            self._last_update_monotonic = time.monotonic()
            self._update_server_metadata_locked(last_mutation_at=touched_at)
            if self._active_mutation_count > 0:
                self._active_mutation_count -= 1
        return touched_at

    def refresh_idle_deadline(self) -> str:
        touched_at = _utc_now()
        with self._lifecycle_lock:
            self._last_update_monotonic = time.monotonic()
            self._update_server_metadata_locked(last_mutation_at=touched_at)
        return touched_at

    def request_shutdown(self, *, reason: str) -> bool:
        with self._lifecycle_lock:
            if self._shutdown_requested:
                return False
            self._shutdown_requested = True
            self._update_server_metadata_locked(
                shutdown_reason=reason,
                stopping_at=_utc_now(),
            )
        self.close_sse_subscribers()
        threading.Thread(target=self._shutdown_http_loop, daemon=True).start()
        return True

    def close_sse_subscribers(self) -> None:
        with self._sse_lock:
            subscriber_sets = list(self._sse_subscribers.values())
            self._sse_subscribers.clear()
        for subscribers in subscriber_sets:
            for subscriber in subscribers:
                self._enqueue_sse_close(subscriber)

    def service_actions(self) -> None:
        super().service_actions()
        if self.idle_timeout_seconds <= 0:
            return
        with self._lifecycle_lock:
            if self._shutdown_requested:
                return
            if self._active_mutation_count > 0:
                return
            idle_for = time.monotonic() - self._last_update_monotonic
        if idle_for >= float(self.idle_timeout_seconds):
            self.request_shutdown(reason="idle-timeout")

    def _shutdown_http_loop(self) -> None:
        _ThreadingHTTPServer.shutdown(self)

    @staticmethod
    def _enqueue_sse_message(subscriber: queue.Queue[str], message: str) -> None:
        try:
            subscriber.put_nowait(message)
        except queue.Full:
            try:
                subscriber.get_nowait()
            except queue.Empty:
                pass
            try:
                subscriber.put_nowait(message)
            except queue.Full:
                pass

    @staticmethod
    def _enqueue_sse_close(subscriber: queue.Queue[str]) -> None:
        for _ in range(256):
            try:
                subscriber.put_nowait(_SSE_CLOSE_SENTINEL)
                return
            except queue.Full:
                try:
                    subscriber.get_nowait()
                except queue.Empty:
                    pass
        try:
            subscriber.put(_SSE_CLOSE_SENTINEL, timeout=0.05)
        except queue.Full:
            pass

    def _update_server_metadata_locked(
        self,
        *,
        last_mutation_at: str | None = None,
        shutdown_reason: str | None = None,
        stopping_at: str | None = None,
    ) -> None:
        metadata = _read_server_metadata(self.runtime_root)
        if metadata is None:
            return
        try:
            descriptor_pid = int(metadata.get("pid", -1))
        except (TypeError, ValueError):
            return
        if descriptor_pid != os.getpid():
            return
        if last_mutation_at is not None:
            metadata["last_mutation_at"] = last_mutation_at
        if shutdown_reason is not None:
            metadata["shutdown_reason"] = shutdown_reason
            metadata["stopping_at"] = stopping_at or _utc_now()
        atomic_write_json(server_metadata_path(self.runtime_root), metadata)


class _HealthHandler(BaseHTTPRequestHandler):
    server_version = "localhost-live/0.1"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        server = self._typed_server()
        path = self._validated_request_path(server)
        if path == "/health":
            metadata = _read_server_metadata(server.runtime_root) or {}
            payload = {
                "ok": True,
                "kind": "health",
                "pid": os.getpid(),
                "timestamp": _utc_now(),
                "last_mutation_at": metadata.get("last_mutation_at"),
            }
            self._send_json(200, payload)
            return
        if path.startswith(_VENDOR_ROUTE_PREFIX):
            vendor_relative = path[len(_VENDOR_ROUTE_PREFIX) :]
            target = _resolve_vendor_file(vendor_relative)
            self._send_file(200, target)
            return
        if path.startswith("/s/"):
            self._handle_browser_get(server, path)
            return
        self.send_error(404, "Not Found")

    def do_POST(self) -> None:  # noqa: N802
        server = self._typed_server()
        path = self._validated_request_path(server)
        if path == "/control/session/create":
            self._require_control_token(server)
            payload = self._read_json()
            server.begin_mutation_activity()
            try:
                created = server.registry.create_session(
                    title=_coerce_optional_string(payload.get("title")),
                    source=_coerce_optional_string(payload.get("source")),
                    entry=_coerce_string(payload.get("entry"), default="index.html"),
                )
                manifest = server.registry.load_manifest(created.session_id)
            finally:
                server.complete_mutation_activity()
            self._send_json(
                200,
                {
                    "session_id": created.session_id,
                    "state_count": int(manifest["state_count"]),
                    "manifest_path": str(created.manifest_path),
                    "viewer_url": f"/s/{created.session_id}/",
                },
            )
            return

        if path == "/control/push":
            self._require_control_token(server)
            payload = self._read_json()
            server.begin_mutation_activity()
            try:
                pushed = server.registry.push_state(
                    _coerce_string(payload.get("session_id")),
                    source=_coerce_string(payload.get("source")),
                    entry=_coerce_string(payload.get("entry"), default="index.html"),
                    replace_latest=bool(payload.get("replace_latest", False)),
                )
                manifest = server.registry.load_manifest(pushed.session_id)
                state_payload = _manifest_state_for_id(manifest, pushed.state_id)
                server.publish_state_added(pushed.session_id, state_payload)
            finally:
                server.complete_mutation_activity()
            self._send_json(
                200,
                {
                    "session_id": pushed.session_id,
                    "state_id": pushed.state_id,
                    "entry": state_payload["entry"],
                    "state_url": state_payload["url"],
                    "viewer_url": f"/s/{pushed.session_id}/",
                    "manifest_path": str(pushed.manifest_path),
                    "source": state_payload.get("source"),
                    "replaced_latest": pushed.replaced_latest,
                },
            )
            return

        if path == "/control/touch":
            self._require_control_token(server)
            server.begin_mutation_activity()
            touched_at = server.complete_mutation_activity()
            self._send_json(200, {"ok": True, "touched_at": touched_at})
            return

        if path == "/control/stop":
            self._require_control_token(server)
            server.begin_mutation_activity()
            try:
                initiated = server.request_shutdown(reason="control-stop")
            finally:
                touched_at = server.complete_mutation_activity()
            self._send_json(
                200,
                {
                    "ok": True,
                    "stopping": True,
                    "already_stopping": not initiated,
                    "touched_at": touched_at,
                },
            )
            return

        self._send_json(404, {"ok": False, "error": f"unknown route: {path}"})

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("invalid JSON body") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def _require_control_token(self, server: _LocalhostLiveHTTPServer) -> None:
        auth = self.headers.get("Authorization", "")
        expected = f"Bearer {server.control_token}"
        if not auth or not hmac.compare_digest(auth, expected):
            raise PermissionError("missing or invalid control token")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, status: int, path: Path, *, csp: str | None = None) -> None:
        mime_type, _encoding = mimetypes.guess_type(str(path))
        content_type = mime_type or "application/octet-stream"
        if content_type.startswith("text/"):
            content_type = f"{content_type}; charset=utf-8"

        data = path.read_bytes()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        if csp:
            self.send_header("Content-Security-Policy", csp)
        self.end_headers()
        self.wfile.write(data)

    def _send_html(self, status: int, html: str, *, csp: str | None = None) -> None:
        data = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        if csp:
            self.send_header("Content-Security-Policy", csp)
        self.end_headers()
        self.wfile.write(data)

    def _validated_request_path(self, server: _LocalhostLiveHTTPServer) -> str:
        self._validate_host_header(server)
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if not path.startswith("/"):
            raise ValueError("Invalid request path")
        return path

    def _validate_host_header(self, server: _LocalhostLiveHTTPServer) -> None:
        host_header = self.headers.get("Host")
        if not host_header:
            return
        host_header = host_header.strip().lower()
        if "," in host_header:
            raise ValueError("Invalid Host header")

        host = host_header
        port_text: str | None = None
        if host_header.startswith("["):
            end = host_header.find("]")
            if end == -1:
                raise ValueError("Invalid Host header")
            host = host_header[1:end]
            remainder = host_header[end + 1 :]
            if remainder:
                if not remainder.startswith(":"):
                    raise ValueError("Invalid Host header")
                port_text = remainder[1:]
        elif ":" in host_header:
            pieces = host_header.split(":")
            if len(pieces) != 2:
                raise ValueError("Invalid Host header")
            host, port_text = pieces

        allowed_hosts = {"127.0.0.1", "localhost", "::1"}
        if host not in allowed_hosts:
            raise ValueError("Invalid Host header")

        if port_text:
            try:
                port = int(port_text)
            except ValueError as exc:
                raise ValueError("Invalid Host header") from exc
            if port != int(server.server_port):
                raise ValueError("Invalid Host header")

    def _handle_browser_get(self, server: _LocalhostLiveHTTPServer, path: str) -> None:
        parts = [part for part in path.split("/") if part]
        if len(parts) < 2 or parts[0] != "s":
            raise FileNotFoundError("Not found")

        session_id = parts[1]
        manifest = server.registry.load_manifest(session_id)

        if len(parts) == 2 and path.endswith("/"):
            self._send_html(
                200,
                _render_viewer_shell(session_id),
                csp=_TRUSTED_SHELL_CSP,
            )
            return

        if len(parts) == 3 and parts[2] == "shell.js":
            self._send_file(
                200,
                _viewer_shell_asset_path("viewer_shell.js"),
            )
            return

        if len(parts) == 3 and parts[2] == "shell.css":
            self._send_file(
                200,
                _viewer_shell_asset_path("viewer_shell.css"),
            )
            return

        if len(parts) == 3 and parts[2] == "manifest.json":
            self._send_json(200, manifest)
            return

        if len(parts) == 3 and parts[2] == "events":
            self._handle_events_stream(server, session_id, manifest)
            return

        if len(parts) >= 4 and parts[2] == "states":
            state_id = parts[3]
            try:
                manifest_state = _manifest_state_for_id(manifest, state_id)
            except ValueError as exc:
                raise FileNotFoundError("Unknown state root") from exc
            content_root = server.registry.state_root(session_id, state_id) / "content"
            if not content_root.exists():
                raise FileNotFoundError("Unknown state root")

            prefix = f"/s/{session_id}/states/{state_id}/"
            if path == prefix:
                entry = str(manifest_state["entry"])
                entry_target = _resolve_public_file(content_root, entry)
                self._send_file(200, entry_target)
                return

            if not path.startswith(prefix):
                raise FileNotFoundError("Not found")

            relative_asset = path[len(prefix) :]
            asset_target = _resolve_public_file(content_root, relative_asset)
            self._send_file(200, asset_target)
            return

        raise FileNotFoundError("Not found")

    def _handle_events_stream(
        self,
        server: _LocalhostLiveHTTPServer,
        session_id: str,
        manifest: dict[str, Any],
    ) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.flush()

        self._send_initial_sse_events(manifest)
        subscriber = server.subscribe_events(session_id)
        try:
            while True:
                try:
                    message = subscriber.get(timeout=SSE_HEARTBEAT_SECONDS)
                    if message == _SSE_CLOSE_SENTINEL:
                        return
                    self.wfile.write(message.encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(_format_sse_comment("heartbeat").encode("utf-8"))
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return
        finally:
            server.unsubscribe_events(session_id, subscriber)

    def _send_initial_sse_events(self, manifest: dict[str, Any]) -> None:
        states = manifest.get("states", [])
        if not isinstance(states, list):
            states = []

        cursor = _parse_last_event_id(self.headers.get("Last-Event-ID"))
        if cursor is not None:
            missed = [
                state
                for state in states
                if isinstance(state, dict) and int(state.get("sequence", 0)) > cursor
            ]
            if missed:
                for state in missed:
                    event_id = str(state.get("sequence", ""))
                    self.wfile.write(
                        _format_sse_event("state-added", state, event_id=event_id).encode(
                            "utf-8"
                        )
                    )
                    self.wfile.flush()
                return

        latest_sequence = 0
        latest_state_id = None
        if states:
            latest = states[-1]
            if isinstance(latest, dict):
                latest_sequence = int(latest.get("sequence", 0))
                latest_state_id = latest.get("state_id")

        event_name = "sync" if latest_sequence > 0 else "hello"
        payload = {
            "session_id": manifest.get("session_id"),
            "latest_sequence": latest_sequence,
            "latest_state_id": latest_state_id,
        }
        event_id = str(latest_sequence) if latest_sequence > 0 else None
        self.wfile.write(
            _format_sse_event(event_name, payload, event_id=event_id).encode("utf-8")
        )
        self.wfile.flush()

    def _typed_server(self) -> _LocalhostLiveHTTPServer:
        server = self.server
        if not isinstance(server, _LocalhostLiveHTTPServer):
            raise RuntimeError("Unexpected HTTP server type")
        return server

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_error(
        self, code: int, message: str | None = None, explain: str | None = None
    ) -> None:
        payload = {"ok": False, "error": message or explain or "request failed"}
        self._send_json(code, payload)

    def handle_one_request(self) -> None:
        try:
            super().handle_one_request()
        except PermissionError as exc:
            self._send_json(401, {"ok": False, "error": str(exc)})
        except SessionNotFoundError as exc:
            self._send_json(404, {"ok": False, "error": str(exc)})
        except ImportRejectedError as exc:
            detail = ", ".join(exc.diagnostics) if exc.diagnostics else str(exc)
            self._send_json(400, {"ok": False, "error": detail})
        except (FileNotFoundError, ValueError) as exc:
            self._send_json(400, {"ok": False, "error": str(exc)})
        except Exception as exc:  # pragma: no cover - defensive transport boundary
            self._send_json(500, {"ok": False, "error": str(exc)})


def run_server_process(
    *,
    runtime_root: str | Path,
    host: str,
    port: int,
    idle_timeout_seconds: int,
) -> None:
    root = resolve_runtime_root(runtime_root)
    root.mkdir(parents=True, exist_ok=True)
    control_token = ensure_control_token(root)
    token_path = control_token_path(root)
    httpd = _LocalhostLiveHTTPServer((host, port), root, idle_timeout_seconds)
    if not hmac.compare_digest(httpd.control_token, control_token):
        raise RuntimeError("Control token mismatch between runtime and server")
    chosen_port = int(httpd.server_address[1])

    server_payload = build_server_metadata(
        host=host,
        port=chosen_port,
        pid=os.getpid(),
        idle_timeout_seconds=idle_timeout_seconds,
        token_path=str(token_path),
        started_at=_utc_now(),
        last_mutation_at=None,
    )
    atomic_write_json(server_metadata_path(root), server_payload)

    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        httpd.close_sse_subscribers()
        httpd.server_close()
        _remove_server_metadata_if_matches_pid(root, os.getpid())


def parse_serve_args(args: argparse.Namespace) -> tuple[Path, str, int, int]:
    runtime_root = resolve_runtime_root(args.runtime_root)
    host = str(args.host)
    port = int(args.port)
    idle_timeout_seconds = int(args.idle_timeout)
    return runtime_root, host, port, idle_timeout_seconds


def discover_healthy_server(runtime_root: str | Path) -> dict[str, Any] | None:
    root = resolve_runtime_root(runtime_root)
    metadata_path = server_metadata_path(root)
    if not metadata_path.exists():
        return None

    try:
        metadata = read_json(metadata_path)
        host = str(metadata["host"])
        port = int(metadata["port"])
    except (ValueError, TypeError, KeyError):
        return None

    if _probe_health(host, port):
        return metadata
    return None


def ensure_healthy_server(
    *,
    runtime_root: str | Path,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    idle_timeout_seconds: int = DEFAULT_IDLE_TIMEOUT_SECONDS,
    no_start: bool = False,
    startup_timeout_seconds: float = 5.0,
) -> tuple[dict[str, Any], bool]:
    existing = discover_healthy_server(runtime_root)
    if existing is not None:
        return existing, False

    if no_start:
        raise ServerUnavailableError("No healthy localhost-live server and --no-start specified")

    process = _spawn_server_process(
        runtime_root=runtime_root,
        host=host,
        port=port,
        idle_timeout_seconds=idle_timeout_seconds,
    )
    try:
        deadline = time.monotonic() + startup_timeout_seconds
        while time.monotonic() < deadline:
            alive = process.poll() is None
            if not alive:
                raise ServerUnavailableError("Server process exited during startup")
            discovered = discover_healthy_server(runtime_root)
            if discovered is not None:
                return discovered, True
            time.sleep(0.05)
        raise ServerUnavailableError("Timed out waiting for localhost-live server startup")
    except Exception:
        _terminate_process(process)
        _remove_server_metadata_if_matches_pid(runtime_root, process.pid)
        raise


def _spawn_server_process(
    *,
    runtime_root: str | Path,
    host: str,
    port: int,
    idle_timeout_seconds: int,
) -> subprocess.Popen[bytes]:
    cmd = [
        sys.executable,
        "-m",
        "localhost_live",
        "--runtime-root",
        str(resolve_runtime_root(runtime_root)),
        "_serve",
        "--host",
        host,
        "--port",
        str(port),
        "--idle-timeout",
        str(idle_timeout_seconds),
    ]
    return subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=str(Path.cwd()),
        start_new_session=True,
    )


def _probe_health(host: str, port: int, timeout_seconds: float = 0.4) -> bool:
    url = f"http://{host}:{port}/health"
    request = Request(url, method="GET")
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            if response.status != 200:
                return False
            body = json.loads(response.read().decode("utf-8"))
            return bool(body.get("ok"))
    except (URLError, TimeoutError, ValueError, OSError):
        return False


def control_post_json(
    *,
    runtime_root: str | Path,
    host: str,
    port: int,
    route: str,
    payload: dict[str, Any],
    token: str,
    timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url=f"http://{host}:{port}{route}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        data=body,
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            parsed = json.loads(response.read().decode("utf-8"))
            if not isinstance(parsed, dict):
                raise ValueError("Invalid control response payload")
            return parsed
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ValueError(f"control route {route} failed: HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise ServerUnavailableError(f"control route {route} unreachable: {exc}") from exc


def read_control_token(runtime_root: str | Path) -> str:
    token_path = control_token_path(resolve_runtime_root(runtime_root))
    token = token_path.read_text(encoding="utf-8").strip()
    if not token:
        raise ValueError(f"Control token file is empty: {token_path}")
    return token


def _terminate_process(process: subprocess.Popen[bytes], timeout_seconds: float = 0.5) -> None:
    if process.poll() is not None:
        return
    try:
        process.terminate()
        process.wait(timeout=timeout_seconds)
        return
    except subprocess.TimeoutExpired:
        pass
    except Exception:
        pass

    if process.poll() is None:
        try:
            process.kill()
            process.wait(timeout=timeout_seconds)
        except Exception:
            pass


def _remove_server_metadata_if_matches_pid(runtime_root: str | Path, pid: int) -> None:
    path = server_metadata_path(resolve_runtime_root(runtime_root))
    if not path.exists():
        return
    try:
        payload = read_json(path)
        descriptor_pid = int(payload.get("pid", -1))
    except Exception:
        descriptor_pid = -1
    if descriptor_pid == pid:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _mark_server_metadata_stopping(runtime_root: str | Path, *, pid: int, reason: str) -> None:
    root = resolve_runtime_root(runtime_root)
    metadata_path = server_metadata_path(root)
    if not metadata_path.exists():
        return
    try:
        metadata = read_json(metadata_path)
        descriptor_pid = int(metadata.get("pid", -1))
    except Exception:
        return
    if descriptor_pid != pid:
        return
    metadata["stopping_at"] = _utc_now()
    metadata["shutdown_reason"] = reason
    atomic_write_json(metadata_path, metadata)


def _touch_last_mutation(runtime_root: str | Path, *, touched_at: str | None = None) -> str:
    root = resolve_runtime_root(runtime_root)
    metadata_path = server_metadata_path(root)
    metadata = _read_server_metadata(root)
    if metadata is None:
        raise ValueError(f"Missing server metadata: {metadata_path}")
    if touched_at is None:
        touched_at = _utc_now()
    metadata["last_mutation_at"] = touched_at
    atomic_write_json(metadata_path, metadata)
    return touched_at


def _read_server_metadata(runtime_root: str | Path) -> dict[str, Any] | None:
    metadata_path = server_metadata_path(resolve_runtime_root(runtime_root))
    if not metadata_path.exists():
        return None
    try:
        metadata = read_json(metadata_path)
    except Exception:
        return None
    return metadata


def _manifest_state_for_id(manifest: dict[str, Any], state_id: str) -> dict[str, Any]:
    states = manifest.get("states", [])
    if not isinstance(states, list):
        raise ValueError("Invalid manifest states payload")
    for state in states:
        if isinstance(state, dict) and state.get("state_id") == state_id:
            return state
    raise ValueError(f"State {state_id} not found in manifest")


def _coerce_string(value: Any, *, default: str | None = None) -> str:
    if value is None:
        if default is None:
            raise ValueError("missing required field")
        return default
    text = str(value)
    if not text:
        if default is None:
            raise ValueError("missing required field")
        return default
    return text


def _coerce_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text else None


def _format_sse_event(
    event_name: str, payload: dict[str, Any], *, event_id: str | None = None
) -> str:
    lines: list[str] = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_name}")
    data_json = json.dumps(payload, separators=(",", ":"))
    lines.append(f"data: {data_json}")
    return "\n".join(lines) + "\n\n"


def _format_sse_comment(comment: str) -> str:
    return f": {comment}\n\n"


def _parse_last_event_id(header_value: str | None) -> int | None:
    if not header_value:
        return None
    value = header_value.strip()
    if not value:
        return None
    if value.isdigit():
        return int(value)
    if len(value) == 6 and value.isdigit():
        return int(value)
    return None


def _render_viewer_shell(
    session_id: str,
    *,
    shell_css_url: str | None = None,
    shell_js_url: str | None = None,
    manifest_url: str | None = None,
    events_url: str | None = None,
) -> str:
    css_href = shell_css_url or f"/s/{session_id}/shell.css"
    js_src = shell_js_url or f"/s/{session_id}/shell.js"
    manifest_href = manifest_url or f"/s/{session_id}/manifest.json"
    if events_url is None:
        events_href = f"/s/{session_id}/events"
    else:
        events_href = events_url
    events_attr = (
        f'\n    data-events-url="{events_href}"' if events_href else ""
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>localhost-live viewer</title>
  <link rel="stylesheet" href="{css_href}">
  <script defer src="{js_src}"></script>
</head>
<body>
  <main
    id="viewer-root"
    class="viewer-root"
    data-session-id="{session_id}"
    data-manifest-url="{manifest_href}"{events_attr}
    data-sandbox-default="allow-scripts allow-same-origin"
    data-sandbox-strict="allow-scripts"
  >
    <div class="viewer-stage" aria-live="polite">
      <iframe
        id="viewer-frame-a"
        class="viewer-frame is-active"
        title="state frame A"
        sandbox="allow-scripts allow-same-origin"
      ></iframe>
      <iframe
        id="viewer-frame-b"
        class="viewer-frame"
        title="state frame B"
        sandbox="allow-scripts allow-same-origin"
      ></iframe>
      <div class="viewer-empty" id="viewer-empty">Waiting for state...</div>
    </div>
    <div class="viewer-overlay">
      <div class="viewer-brand">localhost-live viewer</div>
      <div class="viewer-status" id="viewer-status">No states</div>
      <div class="viewer-controls">
        <button type="button" data-action="home" aria-label="First state">Home</button>
        <button type="button" data-action="prev" aria-label="Previous state">Prev</button>
        <button type="button" data-action="next" aria-label="Next state">Next</button>
        <button type="button" data-action="end" aria-label="Latest state">End</button>
      </div>
    </div>
  </main>
</body>
</html>
"""


def _viewer_shell_asset_path(filename: str) -> Path:
    if filename not in {"viewer_shell.js", "viewer_shell.css"}:
        raise FileNotFoundError("Unknown shell asset")
    return Path(__file__).with_name(filename)


def _vendor_asset_root() -> Path:
    return Path(__file__).with_name("static") / "vendor"


def _resolve_vendor_file(relative: str) -> Path:
    if not relative:
        raise FileNotFoundError("Not found")
    candidate_path = Path(relative)
    if candidate_path.is_absolute():
        raise FileNotFoundError("Not found")
    for part in candidate_path.parts:
        if part in {"", ".", ".."}:
            raise FileNotFoundError("Not found")

    root = _vendor_asset_root().resolve()
    target = (root / candidate_path).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise FileNotFoundError("Not found") from exc
    if not target.exists() or not target.is_file():
        raise FileNotFoundError("Not found")
    return target


def _resolve_public_file(content_root: Path, relative: str) -> Path:
    candidate_path = Path(relative)
    if not relative:
        raise FileNotFoundError("Not found")
    if candidate_path.is_absolute():
        raise FileNotFoundError("Not found")

    for part in candidate_path.parts:
        lowered = part.lower()
        if part in ("", ".", ".."):
            raise FileNotFoundError("Not found")
        if part.startswith("."):
            raise FileNotFoundError("Not found")
        if lowered == ".env":
            raise FileNotFoundError("Not found")
        if lowered == ".git" or lowered.startswith(".git"):
            raise FileNotFoundError("Not found")
        if _is_secret_like_name(lowered):
            raise FileNotFoundError("Not found")

    resolved_root = content_root.resolve()
    resolved_target = (content_root / candidate_path).resolve()
    try:
        resolved_target.relative_to(resolved_root)
    except ValueError as exc:
        raise FileNotFoundError("Not found") from exc

    if resolved_target.is_symlink():
        raise FileNotFoundError("Not found")
    if not resolved_target.exists():
        raise FileNotFoundError("Not found")
    if resolved_target.is_dir():
        raise FileNotFoundError("Not found")
    if not resolved_target.is_file():
        raise FileNotFoundError("Not found")
    return resolved_target


def _is_secret_like_name(lowered_name: str) -> bool:
    if lowered_name in {"id_rsa", "id_dsa", "authorized_keys"}:
        return True
    if lowered_name.endswith((".pem", ".p12", ".key", ".pfx")):
        return True
    return any(marker in lowered_name for marker in _SECRET_MARKERS)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
