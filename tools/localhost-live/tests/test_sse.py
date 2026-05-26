from __future__ import annotations

import http.client
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


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


def _start_server(runtime_root: Path) -> dict[str, object]:
    result = _run_module_command(
        ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _stop_server(runtime_root: Path) -> None:
    _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
    server_path = runtime_root / "server.json"
    if not server_path.exists():
        return
    try:
        payload = json.loads(server_path.read_text(encoding="utf-8"))
        os.kill(int(payload["pid"]), signal.SIGTERM)
    except Exception:
        pass


def _open_sse(
    *, host: str, port: int, session_id: str, last_event_id: str | None = None
) -> tuple[http.client.HTTPConnection, http.client.HTTPResponse]:
    conn = http.client.HTTPConnection(host, port, timeout=5.0)
    headers = {"Accept": "text/event-stream", "Host": f"localhost:{port}"}
    if last_event_id is not None:
        headers["Last-Event-ID"] = last_event_id
    conn.request("GET", f"/s/{session_id}/events", headers=headers)
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


def _parse_sse_event(lines: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in lines:
        if line.startswith(":"):
            parsed["comment"] = line[1:].strip()
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def test_events_route_content_type_and_initial_sync(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "one.html"
    source.write_text("<html>one</html>", encoding="utf-8")
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    try:
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
            assert response.getheader("Content-Type", "").startswith("text/event-stream")
            event = _parse_sse_event(_read_sse_block(response))
            assert event.get("event") in {"hello", "sync"}
            assert json.loads(event["data"])["latest_sequence"] == 1
        finally:
            conn.close()
    finally:
        _stop_server(runtime_root)


def test_push_emits_state_added_event_with_sequence_id(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source1 = tmp_path / "one.html"
    source2 = tmp_path / "two.html"
    source1.write_text("<html>one</html>", encoding="utf-8")
    source2.write_text("<html>two</html>", encoding="utf-8")
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    try:
        create = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "session",
                "create",
                "--from",
                str(source1),
                "--json",
            ]
        )
        assert create.returncode == 0, create.stderr
        session_id = str(json.loads(create.stdout)["session_id"])

        conn, response = _open_sse(host=host, port=port, session_id=session_id)
        try:
            _read_sse_block(response)  # initial hello/sync
            push = _run_module_command(
                [
                    "--runtime-root",
                    str(runtime_root),
                    "push",
                    session_id,
                    "--from",
                    str(source2),
                    "--json",
                ]
            )
            assert push.returncode == 0, push.stderr

            event = _parse_sse_event(_read_sse_block(response))
            assert event.get("event") == "state-added"
            assert event.get("id") == "2"
            data = json.loads(event["data"])
            assert data["sequence"] == 2
            assert data["state_id"] == "000002"
        finally:
            conn.close()
    finally:
        _stop_server(runtime_root)


def test_reconnect_with_last_event_id_receives_missed_states(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source1 = tmp_path / "one.html"
    source2 = tmp_path / "two.html"
    source1.write_text("<html>one</html>", encoding="utf-8")
    source2.write_text("<html>two</html>", encoding="utf-8")
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    try:
        create = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "session",
                "create",
                "--from",
                str(source1),
                "--json",
            ]
        )
        assert create.returncode == 0, create.stderr
        session_id = str(json.loads(create.stdout)["session_id"])

        push = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "push",
                session_id,
                "--from",
                str(source2),
                "--json",
            ]
        )
        assert push.returncode == 0, push.stderr

        conn, response = _open_sse(
            host=host, port=port, session_id=session_id, last_event_id="1"
        )
        try:
            event = _parse_sse_event(_read_sse_block(response))
            assert event.get("event") == "state-added"
            assert event.get("id") == "2"
        finally:
            conn.close()
    finally:
        _stop_server(runtime_root)


def test_heartbeat_does_not_update_idle_mutation_timestamp(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "one.html"
    source.write_text("<html>one</html>", encoding="utf-8")
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    try:
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

        metadata_before = json.loads((runtime_root / "server.json").read_text(encoding="utf-8"))
        last_mutation_before = metadata_before.get("last_mutation_at")
        assert last_mutation_before is not None

        conn, response = _open_sse(host=host, port=port, session_id=session_id)
        try:
            _read_sse_block(response)  # initial hello/sync
            deadline = time.time() + 4.0
            heartbeat_seen = False
            while time.time() < deadline:
                event = _parse_sse_event(_read_sse_block(response))
                if "comment" in event:
                    heartbeat_seen = True
                    break
            assert heartbeat_seen is True
        finally:
            conn.close()

        metadata_after = json.loads((runtime_root / "server.json").read_text(encoding="utf-8"))
        assert metadata_after.get("last_mutation_at") == last_mutation_before
    finally:
        _stop_server(runtime_root)
