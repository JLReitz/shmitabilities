from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
HTTP_REQUEST_TIMEOUT_SECONDS = float(
    os.environ.get("LOCALHOST_LIVE_E2E_HTTP_TIMEOUT_SECONDS", "5.0")
)
STOP_HEALTH_TIMEOUT_SECONDS = float(
    os.environ.get("LOCALHOST_LIVE_E2E_STOP_HEALTH_TIMEOUT_SECONDS", "6.0")
)
STOP_SERVER_FILE_TIMEOUT_SECONDS = float(
    os.environ.get("LOCALHOST_LIVE_E2E_STOP_SERVER_FILE_TIMEOUT_SECONDS", "4.0")
)


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


def _http_get_json(host: str, port: int, path: str) -> dict[str, object]:
    request = Request(f"http://{host}:{port}{path}", method="GET")
    with urlopen(request, timeout=HTTP_REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
        assert response.status == 200
        payload = json.loads(response.read().decode("utf-8"))
        assert isinstance(payload, dict)
        return payload


def _http_get_text(host: str, port: int, path: str) -> str:
    request = Request(f"http://{host}:{port}{path}", method="GET")
    with urlopen(request, timeout=HTTP_REQUEST_TIMEOUT_SECONDS) as response:  # noqa: S310
        assert response.status == 200
        return response.read().decode("utf-8")


def _server_is_healthy(host: str, port: int) -> bool:
    try:
        payload = _http_get_json(host, port, "/health")
        return bool(payload.get("ok"))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return False


def _wait_until(predicate: object, *, timeout_seconds: float, interval_seconds: float = 0.05) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if bool(predicate()):
            return True
        time.sleep(interval_seconds)
    return bool(predicate())


def _stop_server_from_runtime(runtime_root: Path) -> None:
    _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
    server_path = runtime_root / "server.json"
    if not server_path.exists():
        return
    try:
        payload = json.loads(server_path.read_text(encoding="utf-8"))
        os.kill(int(payload["pid"]), signal.SIGTERM)
    except Exception:
        pass


def test_e2e_start_create_push_routes_save_export_stop(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    saved_dir = tmp_path / "saved"
    exported_zip = tmp_path / "saved.liveview.zip"
    source1 = tmp_path / "one.html"
    source2 = tmp_path / "two.html"
    source3 = tmp_path / "three.html"
    source1.write_text("<html><body>state-one</body></html>", encoding="utf-8")
    source2.write_text("<html><body>state-two</body></html>", encoding="utf-8")
    source3.write_text("<html><body>state-three</body></html>", encoding="utf-8")

    host = "127.0.0.1"
    port = 0
    try:
        started = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "start",
                "--host",
                host,
                "--port",
                "0",
                "--json",
            ]
        )
        assert started.returncode == 0, started.stderr
        started_payload = json.loads(started.stdout)
        assert started_payload["ok"] is True
        assert started_payload["command"] == "start"
        assert started_payload["host"] == "127.0.0.1"
        port = int(started_payload["port"])
        assert port > 0
        assert _server_is_healthy(host, port) is True

        created = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "session",
                "create",
                "--title",
                "E2E Demo",
                "--from",
                str(source1),
                "--json",
            ]
        )
        assert created.returncode == 0, created.stderr
        created_payload = json.loads(created.stdout)
        session_id = str(created_payload["session_id"])
        assert created_payload["state_count"] == 1

        for source_path in (source2, source3):
            pushed = _run_module_command(
                [
                    "--runtime-root",
                    str(runtime_root),
                    "push",
                    session_id,
                    "--from",
                    str(source_path),
                    "--json",
                ]
            )
            assert pushed.returncode == 0, pushed.stderr

        shell_html = _http_get_text(host, port, f"/s/{session_id}/")
        assert "localhost-live viewer" in shell_html.lower()

        manifest = _http_get_json(host, port, f"/s/{session_id}/manifest.json")
        assert [state["state_id"] for state in manifest["states"]] == [
            "000001",
            "000002",
            "000003",
        ]

        latest_state_html = _http_get_text(host, port, f"/s/{session_id}/states/000003/")
        assert "state-three" in latest_state_html

        saved = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "save",
                session_id,
                "--to",
                str(saved_dir),
                "--json",
            ]
        )
        assert saved.returncode == 0, saved.stderr
        saved_payload = json.loads(saved.stdout)
        assert saved_payload["ok"] is True
        assert saved_payload["command"] == "save"
        assert saved_payload["state_count"] == 3
        assert saved_dir.joinpath("index.html").exists()
        assert saved_dir.joinpath("liveview.session.json").exists()

        exported = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "export",
                session_id,
                "--to",
                str(exported_zip),
                "--json",
            ]
        )
        assert exported.returncode == 0, exported.stderr
        exported_payload = json.loads(exported.stdout)
        assert exported_payload["ok"] is True
        assert exported_payload["command"] == "export"
        assert exported_payload["state_count"] == 3
        assert exported_zip.exists()

        with zipfile.ZipFile(exported_zip, "r") as archive:
            names = set(archive.namelist())
        assert "index.html" in names
        assert "liveview.session.json" in names
        assert "states/000003/content/index.html" in names

        stopped = _run_module_command(
            ["--runtime-root", str(runtime_root), "stop", "--json"]
        )
        assert stopped.returncode == 0, stopped.stderr
        stopped_payload = json.loads(stopped.stdout)
        assert stopped_payload["ok"] is True
        assert stopped_payload["command"] == "stop"

        assert _wait_until(
            lambda: not _server_is_healthy(host, port),
            timeout_seconds=STOP_HEALTH_TIMEOUT_SECONDS,
        )
        assert _wait_until(
            lambda: not (runtime_root / "server.json").exists(),
            timeout_seconds=STOP_SERVER_FILE_TIMEOUT_SECONDS,
        )
    finally:
        _stop_server_from_runtime(runtime_root)
