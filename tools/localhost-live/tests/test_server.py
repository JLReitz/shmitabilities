from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from localhost_live.jsonio import atomic_write_json
from localhost_live.metadata import build_server_metadata
from localhost_live.server import ServerUnavailableError, ensure_healthy_server


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


def _stop_server_from_runtime(runtime_root: Path) -> None:
    server_file = runtime_root / "server.json"
    if not server_file.exists():
        return
    try:
        payload = json.loads(server_file.read_text(encoding="utf-8"))
        pid = int(payload["pid"])
        os.kill(pid, signal.SIGTERM)
    except Exception:
        pass


def test_start_writes_server_metadata_with_expected_fields(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    start = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "start",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
            "--json",
        ]
    )
    assert start.returncode == 0
    payload = json.loads(start.stdout)
    assert payload["command"] == "start"
    assert payload["host"] == "127.0.0.1"
    assert int(payload["port"]) > 0
    assert int(payload["pid"]) > 0
    assert int(payload["idle_timeout_seconds"]) > 0
    assert Path(payload["token_path"]).exists()
    assert Path(payload["server_metadata_path"]).exists()
    _stop_server_from_runtime(runtime_root)


def test_default_host_never_binds_all_interfaces(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    start = _run_module_command(
        ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
    )
    assert start.returncode == 0
    payload = json.loads(start.stdout)
    assert payload["host"] == "127.0.0.1"
    _stop_server_from_runtime(runtime_root)


def test_stale_server_descriptor_is_replaced_by_start(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir(parents=True)
    stale = build_server_metadata(
        host="127.0.0.1",
        port=9,
        pid=999999,
        idle_timeout_seconds=300,
        token_path=str(runtime_root / "control.token"),
        started_at="2026-05-26T00:00:00Z",
    )
    atomic_write_json(runtime_root / "server.json", stale)

    start = _run_module_command(
        ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
    )
    assert start.returncode == 0
    payload = json.loads(start.stdout)
    assert payload["pid"] != 999999
    assert payload["port"] != 9
    _stop_server_from_runtime(runtime_root)


def test_no_start_fails_cleanly_when_no_healthy_server_exists(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "initial.html"
    source.write_text("<html>x</html>", encoding="utf-8")

    create = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "--no-start",
            "session",
            "create",
            "--from",
            str(source),
            "--json",
        ]
    )
    assert create.returncode != 0
    assert "no healthy localhost-live server" in create.stderr.lower()


def test_stale_live_pid_unreachable_health_is_unhealthy_for_no_start_and_replaced_by_start(
    tmp_path: Path,
) -> None:
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir(parents=True)
    sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        stale = build_server_metadata(
            host="127.0.0.1",
            port=1,
            pid=sleeper.pid,
            idle_timeout_seconds=300,
            token_path=str(runtime_root / "control.token"),
            started_at="2026-05-26T00:00:00Z",
        )
        atomic_write_json(runtime_root / "server.json", stale)

        no_start_status = _run_module_command(
            ["--runtime-root", str(runtime_root), "--no-start", "status", "--json"]
        )
        assert no_start_status.returncode == 0
        status_payload = json.loads(no_start_status.stdout)
        assert status_payload["server"] is None

        source = tmp_path / "initial.html"
        source.write_text("<html>x</html>", encoding="utf-8")
        create = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "--no-start",
                "session",
                "create",
                "--from",
                str(source),
                "--json",
            ]
        )
        assert create.returncode != 0
        assert "no healthy localhost-live server" in create.stderr.lower()

        start = _run_module_command(
            ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
        )
        assert start.returncode == 0
        started = json.loads(start.stdout)
        assert started["pid"] != sleeper.pid
    finally:
        _stop_server_from_runtime(runtime_root)
        sleeper.terminate()
        sleeper.wait(timeout=2)


def test_start_bind_failure_returns_nonzero_and_not_healthy(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        occupied_port = sock.getsockname()[1]

        start = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "start",
                "--host",
                "127.0.0.1",
                "--port",
                str(occupied_port),
                "--json",
            ]
        )
        assert start.returncode != 0
        assert "server process exited during startup" in start.stderr.lower()

    status = _run_module_command(["--runtime-root", str(runtime_root), "status", "--json"])
    assert status.returncode == 0
    payload = json.loads(status.stdout)
    assert payload["server"] is None


def test_startup_timeout_cleans_up_spawned_child(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir(parents=True)
    stale = build_server_metadata(
        host="127.0.0.1",
        port=1,
        pid=424242,
        idle_timeout_seconds=300,
        token_path=str(runtime_root / "control.token"),
        started_at="2026-05-26T00:00:00Z",
    )
    atomic_write_json(runtime_root / "server.json", stale)

    class FakeProcess:
        pid = 424242

        def __init__(self) -> None:
            self.terminate_called = False
            self.kill_called = False

        def poll(self) -> None:
            return None

        def terminate(self) -> None:
            self.terminate_called = True

        def wait(self, timeout: float | None = None) -> None:
            raise subprocess.TimeoutExpired("fake", timeout or 0.0)

        def kill(self) -> None:
            self.kill_called = True

    fake_process = FakeProcess()

    def fake_spawn(**_kwargs: object) -> FakeProcess:
        return fake_process

    def always_unhealthy(_runtime_root: Path) -> None:
        return None

    monkeypatch.setattr("localhost_live.server._spawn_server_process", fake_spawn)
    monkeypatch.setattr("localhost_live.server.discover_healthy_server", always_unhealthy)

    with pytest.raises(ServerUnavailableError, match="Timed out waiting"):
        ensure_healthy_server(
            runtime_root=runtime_root,
            startup_timeout_seconds=0.01,
        )

    assert fake_process.terminate_called is True
    assert fake_process.kill_called is True
    assert not (runtime_root / "server.json").exists()
