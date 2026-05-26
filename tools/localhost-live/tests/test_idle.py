from __future__ import annotations

import http.client
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"


def _run_module_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(SRC_DIR) if not existing else f"{SRC_DIR}{os.pathsep}{existing}"
    return subprocess.run(
        [sys.executable, "-m", "localhost_live", *args],
        cwd=PROJECT_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _start_server(runtime_root: Path, *, idle_timeout_seconds: int) -> dict[str, object]:
    result = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "start",
            "--port",
            "0",
            "--idle-timeout",
            str(idle_timeout_seconds),
            "--json",
        ]
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _wait_until(predicate: object, *, timeout_seconds: float, interval_seconds: float = 0.05) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if bool(predicate()):
            return True
        time.sleep(interval_seconds)
    return bool(predicate())


def _server_is_healthy(host: str, port: int) -> bool:
    request = Request(f"http://{host}:{port}/health", method="GET")
    try:
        with urlopen(request, timeout=0.5) as response:  # noqa: S310
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
            return bool(payload.get("ok"))
    except Exception:
        return False


def _control_post(
    *,
    host: str,
    port: int,
    route: str,
    token: str,
    payload: dict[str, object] | None = None,
) -> dict[str, object]:
    data = json.dumps(payload or {}).encode("utf-8")
    request = Request(
        f"http://{host}:{port}{route}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        data=data,
    )
    with urlopen(request, timeout=2.0) as response:  # noqa: S310
        parsed = json.loads(response.read().decode("utf-8"))
        assert isinstance(parsed, dict)
        return parsed


def _get_status(host: str, port: int, route: str) -> int:
    with urlopen(f"http://{host}:{port}{route}", timeout=2.0) as response:  # noqa: S310
        return int(response.status)


def _read_server_metadata(runtime_root: Path) -> dict[str, object] | None:
    path = runtime_root / "server.json"
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(payload, dict)
    return payload


def _has_shutdown_mark(runtime_root: Path) -> bool:
    metadata = _read_server_metadata(runtime_root)
    if metadata is None:
        return False
    stopping_at = metadata.get("stopping_at")
    reason = metadata.get("shutdown_reason")
    return bool(stopping_at) and reason in {"control-stop", "idle-timeout"}


def _open_sse(
    *, host: str, port: int, session_id: str
) -> tuple[http.client.HTTPConnection, http.client.HTTPResponse]:
    conn = http.client.HTTPConnection(host, port, timeout=2.0)
    conn.request("GET", f"/s/{session_id}/events", headers={"Accept": "text/event-stream"})
    response = conn.getresponse()
    return conn, response


def _read_sse_block(response: http.client.HTTPResponse) -> list[str]:
    lines: list[str] = []
    while True:
        raw = response.fp.readline()
        if raw == b"":
            break
        line = raw.decode("utf-8").rstrip("\r\n")
        if line == "":
            return lines
        lines.append(line)
    return lines


def test_idle_shutdown_enforced_without_mutations(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    started = _start_server(runtime_root, idle_timeout_seconds=1)
    host = str(started["host"])
    port = int(started["port"])

    assert _wait_until(
        lambda: not _server_is_healthy(host, port),
        timeout_seconds=4.0,
    )
    assert _wait_until(
        lambda: not (runtime_root / "server.json").exists(),
        timeout_seconds=2.0,
    )


def test_mutations_refresh_idle_deadline_but_passive_manifest_does_not(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>one</html>", encoding="utf-8")
    started = _start_server(runtime_root, idle_timeout_seconds=1)
    host = str(started["host"])
    port = int(started["port"])
    token = (runtime_root / "control.token").read_text(encoding="utf-8").strip()

    create = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "session",
            "create",
            "--from",
            str(source),
            "--json",
        ]
    )
    assert create.returncode == 0, create.stderr
    session_id = str(json.loads(create.stdout)["session_id"])
    metadata_before = _read_server_metadata(runtime_root)
    assert metadata_before is not None
    before_touch = metadata_before["last_mutation_at"]
    assert isinstance(before_touch, str)

    touched = _control_post(
        host=host,
        port=port,
        route="/control/touch",
        token=token,
    )
    assert touched.get("ok") is True
    metadata_after_touch = _read_server_metadata(runtime_root)
    assert metadata_after_touch is not None
    after_touch = metadata_after_touch["last_mutation_at"]
    assert isinstance(after_touch, str)
    assert after_touch >= before_touch

    assert _server_is_healthy(host, port) is True

    assert _get_status(host, port, "/health") == 200
    assert _get_status(host, port, f"/s/{session_id}/") == 200
    assert _get_status(host, port, f"/s/{session_id}/shell.js") == 200
    assert _get_status(host, port, f"/s/{session_id}/shell.css") == 200
    assert _get_status(host, port, f"/s/{session_id}/manifest.json") == 200
    assert _get_status(host, port, f"/s/{session_id}/states/000001/") == 200

    metadata_after_passive_reads = _read_server_metadata(runtime_root)
    assert metadata_after_passive_reads is not None
    assert metadata_after_passive_reads["last_mutation_at"] == after_touch

    assert _wait_until(
        lambda: not _server_is_healthy(host, port),
        timeout_seconds=4.0,
    )


def test_stop_is_explicit_idempotent_and_closes_sse_before_shutdown(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "one.html"
    source.write_text("<html>one</html>", encoding="utf-8")
    started = _start_server(runtime_root, idle_timeout_seconds=60)
    host = str(started["host"])
    port = int(started["port"])

    create = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "session",
            "create",
            "--from",
            str(source),
            "--json",
        ]
    )
    assert create.returncode == 0, create.stderr
    session_id = str(json.loads(create.stdout)["session_id"])

    conn, response = _open_sse(host=host, port=port, session_id=session_id)
    try:
        assert response.status == 200
        _read_sse_block(response)

        stop_first = _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
        assert stop_first.returncode == 0, stop_first.stderr
        first_payload = json.loads(stop_first.stdout)
        assert first_payload["ok"] is True
        assert _wait_until(
            lambda: (_read_server_metadata(runtime_root) is None)
            or _has_shutdown_mark(runtime_root),
            timeout_seconds=2.0,
        )
        metadata_during_stop = _read_server_metadata(runtime_root)
        if metadata_during_stop is not None:
            assert metadata_during_stop.get("stopping_at")
            assert metadata_during_stop.get("shutdown_reason") in {
                "control-stop",
                "idle-timeout",
            }

        closed = False
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            try:
                block = _read_sse_block(response)
            except socket.timeout:
                continue
            if not block:
                closed = True
                break
        assert closed is True
    finally:
        conn.close()

    stop_second = _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
    assert stop_second.returncode == 0, stop_second.stderr
    second_payload = json.loads(stop_second.stdout)
    assert second_payload["ok"] is True

    assert _wait_until(
        lambda: not _server_is_healthy(host, port),
        timeout_seconds=3.0,
    )
    assert _wait_until(
        lambda: not (runtime_root / "server.json").exists(),
        timeout_seconds=2.0,
    )
