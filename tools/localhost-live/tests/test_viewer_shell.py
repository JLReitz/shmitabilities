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
SHELL_JS_PATH = SRC_DIR / "localhost_live" / "viewer_shell.js"


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


def _http_get(*, host: str, port: int, path: str) -> tuple[int, dict[str, str], bytes]:
    request = Request(f"http://{host}:{port}{path}", method="GET")
    with urlopen(request, timeout=3.0) as response:  # noqa: S310
        headers = {key.lower(): value for key, value in response.headers.items()}
        return response.status, headers, response.read()


def _run_node_json(script: str) -> dict[str, object]:
    result = subprocess.run(
        ["node", "-e", script],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    parsed = json.loads(result.stdout)
    assert isinstance(parsed, dict)
    return parsed


def test_shell_assets_are_served_locally(tmp_path: Path) -> None:
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

        _status, _headers, shell_html = _http_get(host=host, port=port, path=f"/s/{session_id}/")
        shell_text = shell_html.decode("utf-8")
        assert f'/s/{session_id}/shell.js' in shell_text
        assert f'/s/{session_id}/shell.css' in shell_text

        status_js, headers_js, body_js = _http_get(
            host=host, port=port, path=f"/s/{session_id}/shell.js"
        )
        assert status_js == 200
        assert "javascript" in headers_js["content-type"]
        assert b"computeSelection" in body_js

        status_css, headers_css, body_css = _http_get(
            host=host, port=port, path=f"/s/{session_id}/shell.css"
        )
        assert status_css == 200
        assert headers_css["content-type"].startswith("text/css")
        assert b".viewer-frame" in body_css
    finally:
        _stop_server(runtime_root)


def test_shell_state_selection_logic_unit() -> None:
    script = f"""
const shell = require({json.dumps(str(SHELL_JS_PATH))});
const states = [
  {{ state_id: "000001", sequence: 1, url: "/1/" }},
  {{ state_id: "000002", sequence: 2, url: "/2/" }},
  {{ state_id: "000003", sequence: 3, url: "/3/" }},
];
const initial = shell.computeSelection({{
  states,
  selectedIndex: null,
  latestSequence: 0,
}});
const clamped = shell.computeSelection({{
  states,
  selectedIndex: 99,
  latestSequence: 3,
}});
process.stdout.write(JSON.stringify({{ initial, clamped }}));
"""
    payload = _run_node_json(script)
    initial = payload["initial"]
    clamped = payload["clamped"]
    assert isinstance(initial, dict)
    assert isinstance(clamped, dict)
    assert initial["selectedIndex"] == 2
    assert initial["latestSequence"] == 3
    assert initial["autoAdvanced"] is True
    assert clamped["selectedIndex"] == 2
    assert clamped["autoAdvanced"] is False


def test_shell_prev_next_home_end_navigation_unit() -> None:
    script = f"""
const shell = require({json.dumps(str(SHELL_JS_PATH))});
const result = {{
  prevFromTwo: shell.navigateSelection("prev", 2, 4),
  prevFromZero: shell.navigateSelection("prev", 0, 4),
  nextFromTwo: shell.navigateSelection("next", 2, 4),
  nextFromEnd: shell.navigateSelection("next", 3, 4),
  homeFromTwo: shell.navigateSelection("home", 2, 4),
  endFromZero: shell.navigateSelection("end", 0, 4),
}};
process.stdout.write(JSON.stringify(result));
"""
    payload = _run_node_json(script)
    assert payload["prevFromTwo"] == 1
    assert payload["prevFromZero"] == 0
    assert payload["nextFromTwo"] == 3
    assert payload["nextFromEnd"] == 3
    assert payload["homeFromTwo"] == 0
    assert payload["endFromZero"] == 3


def test_shell_auto_advances_to_newest_after_manual_back_navigation_unit() -> None:
    script = f"""
const shell = require({json.dumps(str(SHELL_JS_PATH))});
const firstStates = [
  {{ state_id: "000001", sequence: 1, url: "/1/" }},
  {{ state_id: "000002", sequence: 2, url: "/2/" }},
  {{ state_id: "000003", sequence: 3, url: "/3/" }},
];
const initial = shell.computeSelection({{
  states: firstStates,
  selectedIndex: null,
  latestSequence: 0,
}});
const manualBackIndex = shell.navigateSelection("prev", initial.selectedIndex, firstStates.length);
const updatedStates = firstStates.concat([{{
  state_id: "000004",
  sequence: 4,
  url: "/4/",
}}]);
const afterPush = shell.computeSelection({{
  states: updatedStates,
  selectedIndex: manualBackIndex,
  latestSequence: initial.latestSequence,
}});
process.stdout.write(JSON.stringify({{
  initialIndex: initial.selectedIndex,
  manualBackIndex,
  afterPushIndex: afterPush.selectedIndex,
  afterPushAutoAdvanced: afterPush.autoAdvanced,
}}));
"""
    payload = _run_node_json(script)
    assert payload["initialIndex"] == 2
    assert payload["manualBackIndex"] == 1
    assert payload["afterPushIndex"] == 3
    assert payload["afterPushAutoAdvanced"] is True


def test_shell_reduced_motion_transition_behavior_unit() -> None:
    script = f"""
const shell = require({json.dumps(str(SHELL_JS_PATH))});
const payload = {{
  reduced: shell.transitionDurationMs(true),
  defaultMotion: shell.transitionDurationMs(false),
}};
process.stdout.write(JSON.stringify(payload));
"""
    payload = _run_node_json(script)
    assert payload["reduced"] == 0
    assert payload["defaultMotion"] > 0


def test_shell_keyboard_action_and_sandbox_profile_units() -> None:
    script = f"""
const shell = require({json.dumps(str(SHELL_JS_PATH))});
const keyMap = {{
  left: shell.keyToNavigationAction("ArrowLeft"),
  right: shell.keyToNavigationAction("ArrowRight"),
  home: shell.keyToNavigationAction("Home"),
  end: shell.keyToNavigationAction("End"),
  other: shell.keyToNavigationAction("KeyX"),
}};
const strictWin = {{ location: {{ search: "?sandbox=strict" }} }};
const defaultWin = {{ location: {{ search: "" }} }};
const tokens = {{
  strict: shell.sandboxTokensForProfile({{ dataset: {{ sandboxStrict: "allow-scripts", sandboxDefault: "allow-scripts allow-same-origin" }} }}, "strict"),
  default: shell.sandboxTokensForProfile({{ dataset: {{ sandboxStrict: "allow-scripts", sandboxDefault: "allow-scripts allow-same-origin" }} }}, "default"),
}};
const profiles = {{
  strict: shell.parseSandboxProfile(strictWin),
  default: shell.parseSandboxProfile(defaultWin),
}};
process.stdout.write(JSON.stringify({{ keyMap, tokens, profiles }}));
"""
    payload = _run_node_json(script)
    assert payload["keyMap"]["left"] == "prev"
    assert payload["keyMap"]["right"] == "next"
    assert payload["keyMap"]["home"] == "home"
    assert payload["keyMap"]["end"] == "end"
    assert payload["keyMap"]["other"] is None
    assert payload["profiles"]["strict"] == "strict"
    assert payload["profiles"]["default"] == "default"
    assert payload["tokens"]["strict"] == "allow-scripts"
    assert payload["tokens"]["default"] == "allow-scripts allow-same-origin"
