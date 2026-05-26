from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
VENDOR_ROOT = SRC_DIR / "localhost_live" / "static" / "vendor"

EXPECTED_VENDOR_FILES = (
    "mermaid/mermaid.min.js",
    "reveal/reveal.js",
    "reveal/reveal.css",
    "reveal/theme/simple.css",
    "echarts/echarts.min.js",
    "examples/mermaid-local.html",
    "examples/reveal-local.html",
    "examples/echarts-local.html",
)

EXPECTED_LICENSE_FILES = (
    "LICENSES/MERMAID.txt",
    "LICENSES/REVEALJS.txt",
    "LICENSES/ECHARTS.txt",
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


def _start_server(runtime_root: Path) -> dict[str, object]:
    result = _run_module_command(
        ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert isinstance(payload, dict)
    return payload


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


def _http_get(*, host: str, port: int, path: str) -> tuple[int, dict[str, str], bytes]:
    request = Request(f"http://{host}:{port}{path}", method="GET")
    with urlopen(request, timeout=3.0) as response:  # noqa: S310
        headers = {key.lower(): value for key, value in response.headers.items()}
        return response.status, headers, response.read()


def test_vendor_assets_and_licenses_are_present_on_disk() -> None:
    for relative in (*EXPECTED_VENDOR_FILES, *EXPECTED_LICENSE_FILES):
        candidate = VENDOR_ROOT / relative
        assert candidate.exists()
        assert candidate.is_file()


def test_vendor_assets_are_served_from_stable_paths(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    started = _start_server(runtime_root)
    host = str(started["host"])
    port = int(started["port"])

    try:
        for relative in EXPECTED_VENDOR_FILES:
            status, _headers, body = _http_get(
                host=host, port=port, path=f"/assets/vendor/{relative}"
            )
            assert status == 200
            assert body

        for relative in EXPECTED_LICENSE_FILES:
            status, headers, body = _http_get(
                host=host, port=port, path=f"/assets/vendor/{relative}"
            )
            assert status == 200
            assert headers["content-type"].startswith("text/plain")
            assert body
    finally:
        _stop_server(runtime_root)


def test_vendor_examples_reference_only_local_vendor_paths() -> None:
    for filename in (
        "examples/mermaid-local.html",
        "examples/reveal-local.html",
        "examples/echarts-local.html",
    ):
        text = (VENDOR_ROOT / filename).read_text(encoding="utf-8")
        lowered = text.lower()
        assert "/assets/vendor/" in text
        assert "http://" not in lowered
        assert "https://" not in lowered
        assert "cdn" not in lowered

    mermaid_html = (VENDOR_ROOT / "examples/mermaid-local.html").read_text(encoding="utf-8")
    reveal_html = (VENDOR_ROOT / "examples/reveal-local.html").read_text(encoding="utf-8")
    echarts_html = (VENDOR_ROOT / "examples/echarts-local.html").read_text(encoding="utf-8")

    assert '/assets/vendor/mermaid/mermaid.min.js' in mermaid_html
    assert '/assets/vendor/reveal/reveal.css' in reveal_html
    assert '/assets/vendor/reveal/theme/simple.css' in reveal_html
    assert '/assets/vendor/reveal/reveal.js' in reveal_html
    assert '/assets/vendor/echarts/echarts.min.js' in echarts_html
