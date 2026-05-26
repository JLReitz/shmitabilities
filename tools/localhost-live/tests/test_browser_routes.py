from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
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
    start = _run_module_command(
        ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
    )
    assert start.returncode == 0, start.stderr
    return json.loads(start.stdout)


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


def _http_get(
    *, host: str, port: int, path: str, host_header: str | None = None
) -> tuple[int, dict[str, str], bytes]:
    headers: dict[str, str] = {}
    if host_header is not None:
        headers["Host"] = host_header
    request = Request(f"http://{host}:{port}{path}", headers=headers, method="GET")
    with urlopen(request, timeout=3.0) as response:  # noqa: S310
        hdrs = {k.lower(): v for k, v in response.headers.items()}
        return response.status, hdrs, response.read()


def test_shell_route_serves_html_with_strict_csp(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>hello</html>", encoding="utf-8")

    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    try:
        created = _run_module_command(
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
        assert created.returncode == 0, created.stderr
        session_id = json.loads(created.stdout)["session_id"]

        status, headers, body = _http_get(host=host, port=port, path=f"/s/{session_id}/")
        assert status == 200
        assert headers["content-type"].startswith("text/html")
        csp = headers.get("content-security-policy", "")
        assert "default-src 'none'" in csp
        assert "frame-ancestors 'none'" in csp
        assert b"localhost-live viewer" in body.lower()
    finally:
        _stop_server(runtime_root)


def test_manifest_route_returns_ordered_states_without_token(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source1 = tmp_path / "one.html"
    source2 = tmp_path / "two.html"
    source1.write_text("<html>one</html>", encoding="utf-8")
    source2.write_text("<html>two</html>", encoding="utf-8")

    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])
    token = (runtime_root / "control.token").read_text(encoding="utf-8").strip()
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
        session_id = json.loads(create.stdout)["session_id"]

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

        status, headers, body = _http_get(
            host=host,
            port=port,
            path=f"/s/{session_id}/manifest.json",
        )
        assert status == 200
        assert headers["content-type"].startswith("application/json")
        manifest = json.loads(body.decode("utf-8"))
        assert manifest["session_id"] == session_id
        assert [state["state_id"] for state in manifest["states"]] == ["000001", "000002"]
        serialized = json.dumps(manifest).lower()
        assert token not in serialized
        assert "control.token" not in serialized
    finally:
        _stop_server(runtime_root)


def test_state_entry_route_serves_configured_entry_document(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source_dir = tmp_path / "site"
    source_dir.mkdir()
    (source_dir / "index.html").write_text("<html>index</html>", encoding="utf-8")
    (source_dir / "home.html").write_text("<html>home-entry</html>", encoding="utf-8")
    (source_dir / "assets").mkdir()
    (source_dir / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8")

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
                str(source_dir),
                "--entry",
                "home.html",
                "--json",
            ]
        )
        assert create.returncode == 0, create.stderr
        session_id = json.loads(create.stdout)["session_id"]

        status, headers, body = _http_get(
            host=host,
            port=port,
            path=f"/s/{session_id}/states/000001/",
        )
        assert status == 200
        assert headers["content-type"].startswith("text/html")
        assert b"home-entry" in body
    finally:
        _stop_server(runtime_root)


def test_asset_route_rejects_traversal_dotfiles_secrets_and_listing(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source_dir = tmp_path / "site"
    (source_dir / "assets").mkdir(parents=True)
    (source_dir / "index.html").write_text("<html>index</html>", encoding="utf-8")
    (source_dir / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8")

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
                str(source_dir),
                "--json",
            ]
        )
        assert create.returncode == 0, create.stderr
        session_id = json.loads(create.stdout)["session_id"]

        with pytest.raises(HTTPError):
            _http_get(
                host=host,
                port=port,
                path=f"/s/{session_id}/states/000001/%2e%2e/manifest.json",
            )
        with pytest.raises(HTTPError):
            _http_get(host=host, port=port, path=f"/s/{session_id}/states/000001/.env")
        with pytest.raises(HTTPError):
            _http_get(
                host=host,
                port=port,
                path=f"/s/{session_id}/states/000001/assets/private.key",
            )
        with pytest.raises(HTTPError):
            _http_get(host=host, port=port, path=f"/s/{session_id}/states/000001/assets/")
        with pytest.raises(HTTPError):
            _http_get(host=host, port=port, path=f"/s/{session_id}/states/999999/")
    finally:
        _stop_server(runtime_root)


def test_host_header_validation_accepts_loopback_and_rejects_non_loopback(
    tmp_path: Path,
) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>x</html>", encoding="utf-8")

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
        session_id = json.loads(create.stdout)["session_id"]

        status, _headers, _body = _http_get(
            host=host,
            port=port,
            path=f"/s/{session_id}/",
            host_header=f"localhost:{port}",
        )
        assert status == 200

        with pytest.raises(HTTPError) as excinfo:
            _http_get(
                host=host,
                port=port,
                path=f"/s/{session_id}/",
                host_header=f"evil.example:{port}",
            )
        assert excinfo.value.code == 400
    finally:
        _stop_server(runtime_root)
