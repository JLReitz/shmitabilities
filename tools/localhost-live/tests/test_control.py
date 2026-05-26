from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest


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


def _control_post(
    *,
    host: str,
    port: int,
    route: str,
    payload: dict[str, object],
    token: str | None = None,
) -> dict[str, object]:
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        url=f"http://{host}:{port}{route}",
        method="POST",
        headers=headers,
        data=json.dumps(payload).encode("utf-8"),
    )
    with urlopen(request, timeout=3.0) as response:  # noqa: S310
        parsed = json.loads(response.read().decode("utf-8"))
        assert isinstance(parsed, dict)
        return parsed


def _wait_until(predicate: object, *, timeout_seconds: float, interval_seconds: float = 0.05) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if bool(predicate()):
            return True
        time.sleep(interval_seconds)
    return bool(predicate())


def test_mutating_routes_reject_missing_and_invalid_control_tokens(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    try:
        with pytest.raises(HTTPError) as missing_exc:
            _control_post(host=host, port=port, route="/control/touch", payload={})
        assert missing_exc.value.code == 401

        with pytest.raises(HTTPError) as missing_push:
            _control_post(
                host=host,
                port=port,
                route="/control/push",
                payload={
                    "session_id": "0123456789abcdef0123456789abcdef",
                    "source": str(tmp_path / "missing.html"),
                    "entry": "index.html",
                },
            )
        assert missing_push.value.code == 401

        with pytest.raises(HTTPError) as missing_stop:
            _control_post(host=host, port=port, route="/control/stop", payload={})
        assert missing_stop.value.code == 401

        with pytest.raises(HTTPError) as invalid_exc:
            _control_post(
                host=host,
                port=port,
                route="/control/touch",
                payload={},
                token="badtoken",
            )
        assert invalid_exc.value.code == 401

        with pytest.raises(HTTPError) as invalid_stop:
            _control_post(
                host=host,
                port=port,
                route="/control/stop",
                payload={},
                token="badtoken",
            )
        assert invalid_stop.value.code == 401
    finally:
        _stop_server(runtime_root)


def test_cli_can_create_and_push_through_server_with_token(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    _start_server(runtime_root)
    source1 = tmp_path / "one.html"
    source2 = tmp_path / "two.html"
    source1.write_text("<html>one</html>", encoding="utf-8")
    source2.write_text("<html>two</html>", encoding="utf-8")
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
        created = json.loads(create.stdout)
        session_id = str(created["session_id"])

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
        pushed = json.loads(push.stdout)
        assert pushed["session_id"] == session_id
        assert pushed["state_id"] == "000002"
        assert "token" not in json.dumps(pushed).lower()
    finally:
        _stop_server(runtime_root)


def test_unauthenticated_browser_like_mutation_attempt_fails(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    source = tmp_path / "index.html"
    source.write_text("<html>x</html>", encoding="utf-8")
    try:
        with pytest.raises(HTTPError) as exc:
            _control_post(
                host=host,
                port=port,
                route="/control/session/create",
                payload={"source": str(source)},
            )
        assert exc.value.code == 401
    finally:
        _stop_server(runtime_root)


def test_mutation_updates_idle_timestamp_in_server_metadata(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    token = (runtime_root / "control.token").read_text(encoding="utf-8").strip()

    metadata_before = json.loads((runtime_root / "server.json").read_text(encoding="utf-8"))
    assert metadata_before.get("last_mutation_at") is None
    try:
        touched = _control_post(
            host=host,
            port=port,
            route="/control/touch",
            payload={},
            token=token,
        )
        assert touched.get("ok") is True
        metadata_after = json.loads((runtime_root / "server.json").read_text(encoding="utf-8"))
        assert metadata_after.get("last_mutation_at")
    finally:
        _stop_server(runtime_root)


def test_control_stop_is_idempotent_and_marks_shutdown_metadata(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    token = (runtime_root / "control.token").read_text(encoding="utf-8").strip()

    try:
        first = _control_post(
            host=host,
            port=port,
            route="/control/stop",
            payload={},
            token=token,
        )
        assert first.get("ok") is True
        assert first.get("stopping") is True
        assert first.get("already_stopping") is False
        assert isinstance(first.get("touched_at"), str)

        second_payload: dict[str, object] | None = None
        try:
            second_payload = _control_post(
                host=host,
                port=port,
                route="/control/stop",
                payload={},
                token=token,
            )
        except Exception:
            second_payload = None
        if second_payload is not None:
            assert second_payload.get("ok") is True
            assert second_payload.get("stopping") is True
            assert second_payload.get("already_stopping") is True
            assert isinstance(second_payload.get("touched_at"), str)

        metadata_path = runtime_root / "server.json"
        assert _wait_until(lambda: metadata_path.exists(), timeout_seconds=1.0)
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        assert metadata.get("shutdown_reason") == "control-stop"
        assert isinstance(metadata.get("stopping_at"), str)
    finally:
        _stop_server(runtime_root)
