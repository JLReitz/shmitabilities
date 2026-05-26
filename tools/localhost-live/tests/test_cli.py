from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
from pathlib import Path

from localhost_live import cli as cli_module

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"


def _run_module_command(
    args: list[str],
    *,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    command_env = os.environ.copy()
    for key in list(command_env):
        if key.startswith("LOCALHOST_LIVE_"):
            command_env.pop(key, None)
    if env:
        command_env.update(env)
    existing = command_env.get("PYTHONPATH")
    command_env["PYTHONPATH"] = (
        str(SRC_DIR) if not existing else f"{SRC_DIR}{os.pathsep}{existing}"
    )
    return subprocess.run(
        [sys.executable, "-m", "localhost_live", *args],
        cwd=PROJECT_ROOT,
        env=command_env,
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
        os.kill(int(payload["pid"]), signal.SIGTERM)
    except Exception:
        pass


def test_smoke_import_and_module_help() -> None:
    import localhost_live

    assert hasattr(localhost_live, "__version__")

    result = _run_module_command(["--help"])
    assert result.returncode == 0
    assert "localhost-live" in result.stdout
    assert "session" in result.stdout
    assert "start" in result.stdout


def test_create_push_status_and_url_json_contracts(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    initial_source = tmp_path / "initial.html"
    initial_source.write_text("<html>initial</html>", encoding="utf-8")
    pushed_source = tmp_path / "next.html"
    pushed_source.write_text("<html>next</html>", encoding="utf-8")

    create = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "session",
            "create",
            "--title",
            "Demo",
            "--from",
            str(initial_source),
            "--json",
        ]
    )
    assert create.returncode == 0
    assert create.stderr == ""
    created = json.loads(create.stdout)
    assert re_fullmatch_hex32(created["session_id"])
    assert created["state_count"] == 1
    assert Path(created["manifest_path"]).exists()
    assert created["viewer_url"].endswith(f"/s/{created['session_id']}/")
    assert created["viewer_url"].startswith("http://127.0.0.1:")

    session_id = created["session_id"]
    push = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "push",
            session_id,
            "--from",
            str(pushed_source),
            "--json",
        ]
    )
    assert push.returncode == 0
    assert push.stderr == ""
    pushed = json.loads(push.stdout)
    assert pushed["session_id"] == session_id
    assert pushed["state_id"] == "000002"
    assert pushed["entry"] == "index.html"
    assert pushed["viewer_url"].endswith(f"/s/{session_id}/")
    assert pushed["viewer_url"].startswith("http://127.0.0.1:")
    assert pushed["state_url"] == f"/s/{session_id}/states/000002/"
    assert pushed["manifest_path"] == created["manifest_path"]
    assert pushed["source"]["source_kind"] == "file"

    status_global = _run_module_command(
        ["--runtime-root", str(runtime_root), "status", "--json"]
    )
    assert status_global.returncode == 0
    assert status_global.stderr == ""
    global_payload = json.loads(status_global.stdout)
    assert global_payload["session_count"] == 1
    assert global_payload["runtime_root"] == str(runtime_root)
    assert global_payload["server"] is not None
    assert global_payload["sessions"][0]["session_id"] == session_id
    assert global_payload["sessions"][0]["state_count"] == 2

    status_session = _run_module_command(
        ["--runtime-root", str(runtime_root), "status", session_id, "--json"]
    )
    assert status_session.returncode == 0
    assert status_session.stderr == ""
    session_payload = json.loads(status_session.stdout)
    assert session_payload["session_id"] == session_id
    assert session_payload["state_count"] == 2
    assert session_payload["latest_state_id"] == "000002"
    assert session_payload["viewer_url"].endswith(f"/s/{session_id}/")
    assert session_payload["viewer_url"].startswith("http://127.0.0.1:")
    assert len(session_payload["states"]) == 2

    url = _run_module_command(["--runtime-root", str(runtime_root), "url", session_id])
    assert url.returncode == 0
    assert url.stderr == ""
    assert url.stdout.strip().endswith(f"/s/{session_id}/")
    assert url.stdout.strip().startswith("http://127.0.0.1:")

    url_json = _run_module_command(
        ["--runtime-root", str(runtime_root), "url", session_id, "--json"]
    )
    assert url_json.returncode == 0
    assert url_json.stderr == ""
    assert json.loads(url_json.stdout)["viewer_url"].endswith(f"/s/{session_id}/")
    _stop_server_from_runtime(runtime_root)


def test_key_cli_commands_emit_stable_json_contracts(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>step16</html>", encoding="utf-8")
    save_destination = tmp_path / "saved"
    export_destination = tmp_path / "saved.liveview.zip"
    try:
        start = _run_module_command(
            ["--runtime-root", str(runtime_root), "start", "--port", "0", "--json"]
        )
        assert start.returncode == 0, start.stderr
        started = json.loads(start.stdout)
        assert started["ok"] is True
        assert started["command"] == "start"
        assert started["host"] == "127.0.0.1"
        assert int(started["port"]) > 0
        assert int(started["pid"]) > 0

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
        created = json.loads(create.stdout)
        session_id = created["session_id"]

        status = _run_module_command(["--runtime-root", str(runtime_root), "status", "--json"])
        assert status.returncode == 0, status.stderr
        status_payload = json.loads(status.stdout)
        assert status_payload["runtime_root"] == str(runtime_root)
        assert status_payload["session_count"] == 1
        assert status_payload["sessions"][0]["session_id"] == session_id
        assert status_payload["server"] is not None

        url = _run_module_command(
            ["--runtime-root", str(runtime_root), "url", session_id, "--json"]
        )
        assert url.returncode == 0, url.stderr
        url_payload = json.loads(url.stdout)
        assert url_payload["session_id"] == session_id
        assert url_payload["viewer_url"].endswith(f"/s/{session_id}/")
        assert url_payload["viewer_url"].startswith("http://127.0.0.1:")

        save = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "save",
                session_id,
                "--to",
                str(save_destination),
                "--json",
            ]
        )
        assert save.returncode == 0, save.stderr
        save_payload = json.loads(save.stdout)
        assert save_payload["ok"] is True
        assert save_payload["command"] == "save"
        assert save_payload["session_id"] == session_id
        assert save_payload["state_count"] == 1
        assert Path(save_payload["index_path"]).exists()
        assert Path(save_payload["manifest_path"]).exists()

        export = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "export",
                session_id,
                "--to",
                str(export_destination),
                "--json",
            ]
        )
        assert export.returncode == 0, export.stderr
        export_payload = json.loads(export.stdout)
        assert export_payload["ok"] is True
        assert export_payload["command"] == "export"
        assert export_payload["session_id"] == session_id
        assert export_payload["state_count"] == 1
        assert Path(export_payload["destination"]).exists()
        assert Path(export_payload["index_path"]).name == "index.html"
        assert Path(export_payload["manifest_path"]).name == "liveview.session.json"

        stop = _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
        assert stop.returncode == 0, stop.stderr
        stop_payload = json.loads(stop.stdout)
        assert stop_payload["ok"] is True
        assert stop_payload["command"] == "stop"
        assert isinstance(stop_payload["stopped"], bool)
    finally:
        _stop_server_from_runtime(runtime_root)


def test_view_command_text_and_json_contracts(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>view</html>", encoding="utf-8")
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

        text_view = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "view",
                session_id,
                "--open",
                "never",
            ]
        )
        assert text_view.returncode == 0, text_view.stderr
        assert text_view.stderr == ""
        assert text_view.stdout.strip().startswith("http://127.0.0.1:")
        assert text_view.stdout.strip().endswith(f"/s/{session_id}/")

        json_view = _run_module_command(
            [
                "--runtime-root",
                str(runtime_root),
                "view",
                session_id,
                "--json",
            ]
        )
        assert json_view.returncode == 0, json_view.stderr
        payload = json.loads(json_view.stdout)
        assert payload["ok"] is True
        assert payload["command"] == "view"
        assert payload["session_id"] == session_id
        assert payload["viewer_url"].startswith("http://127.0.0.1:")
        assert payload["viewer_url"].endswith(f"/s/{session_id}/")
        assert payload["open_attempted"] is False
        assert payload["open_succeeded"] is False
        assert "launch_mode" in payload
        assert "detected_environment" in payload
    finally:
        _stop_server_from_runtime(runtime_root)


def test_view_no_start_reuses_relative_url_contract(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>view</html>", encoding="utf-8")
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

    stop = _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
    assert stop.returncode == 0, stop.stderr

    view = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "--no-start",
            "view",
            session_id,
            "--json",
        ]
    )
    assert view.returncode == 0, view.stderr
    payload = json.loads(view.stdout)
    assert payload["viewer_url"] == f"/s/{session_id}/"
    assert payload["launch_supported"] is False
    assert payload["warning"] == "Viewer URL is relative because no healthy server is running"
    assert payload["open_attempted"] is False


def test_view_reports_invalid_session_errors(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    missing_session = "0123456789abcdef0123456789abcdef"
    result = _run_module_command(["--runtime-root", str(runtime_root), "view", missing_session])
    assert result.returncode != 0
    assert "Unknown session" in result.stderr


def test_cli_failures_for_nonexistent_session_and_invalid_path(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "exists.html"
    source.write_text("<html>x</html>", encoding="utf-8")
    missing_source = tmp_path / "missing.html"
    missing_session = "0123456789abcdef0123456789abcdef"

    push_missing_source = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "push",
            missing_session,
            "--from",
            str(missing_source),
            "--json",
        ]
    )
    assert push_missing_source.returncode != 0
    assert "Unknown session" in push_missing_source.stderr

    status_missing_session = _run_module_command(
        ["--runtime-root", str(runtime_root), "status", missing_session, "--json"]
    )
    assert status_missing_session.returncode != 0
    assert "Unknown session" in status_missing_session.stderr

    create_invalid_path = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "session",
            "create",
            "--from",
            str(missing_source),
            "--json",
        ]
    )
    assert create_invalid_path.returncode != 0
    assert create_invalid_path.stderr.strip() != ""
    assert "missing-source" in create_invalid_path.stderr
    sessions_root = runtime_root / "sessions"
    if sessions_root.exists():
        assert list(sessions_root.iterdir()) == []
    status_after_failed_create = _run_module_command(
        ["--runtime-root", str(runtime_root), "status", "--json"]
    )
    assert status_after_failed_create.returncode == 0
    assert json.loads(status_after_failed_create.stdout)["session_count"] == 0

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
    assert created.returncode == 0
    session_id = json.loads(created.stdout)["session_id"]

    push_invalid_path = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "push",
            session_id,
            "--from",
            str(missing_source),
            "--json",
        ]
    )
    assert push_invalid_path.returncode != 0
    assert "missing-source" in push_invalid_path.stderr
    _stop_server_from_runtime(runtime_root)


def re_fullmatch_hex32(candidate: str) -> bool:
    if len(candidate) != 32:
        return False
    return all(ch in "0123456789abcdef" for ch in candidate)


def test_json_flag_outputs_clean_json_for_stub_commands() -> None:
    for args, expected_command in (
        (["stop", "--json"], "stop"),
    ):
        result = _run_module_command(args)
        assert result.returncode == 0
        assert result.stderr == ""
        parsed = json.loads(result.stdout)
        assert isinstance(parsed, dict)
        assert parsed["ok"] is True
        assert parsed["command"] == expected_command


def test_save_requires_destination_flag() -> None:
    result = _run_module_command(["save", "abc123", "--json"])
    assert result.returncode != 0
    assert "--to" in result.stderr


def test_export_requires_destination_flag() -> None:
    result = _run_module_command(["export", "abc123", "--json"])
    assert result.returncode != 0
    assert "--to" in result.stderr


def test_detect_view_environment_precedence() -> None:
    assert (
        cli_module._detect_view_environment(
            env={
                "SSH_CONNECTION": "1",
                "WSL_INTEROP": "1",
                "DISPLAY": ":0",
            },
            platform_name="darwin",
            path_exists=lambda _: False,
        )
        == "ssh"
    )
    assert (
        cli_module._detect_view_environment(
            env={"WSL_INTEROP": "1"},
            platform_name="linux",
            path_exists=lambda _: False,
        )
        == "wsl"
    )
    assert (
        cli_module._detect_view_environment(
            env={},
            platform_name="darwin",
            path_exists=lambda _: False,
        )
        == "macos"
    )
    assert (
        cli_module._detect_view_environment(
            env={"WAYLAND_DISPLAY": "wayland-0"},
            platform_name="linux",
            path_exists=lambda _: False,
        )
        == "linux-gui"
    )
    assert (
        cli_module._detect_view_environment(
            env={},
            platform_name="linux",
            path_exists=lambda _: False,
        )
        == "print-only"
    )


def test_view_plan_handles_ssh_always_and_tunnel_hint() -> None:
    plan = cli_module._plan_view_launch(
        url="http://0.0.0.0:4312/s/demo/",
        open_policy="always",
        env={"SSH_CONNECTION": "1"},
        platform_name="darwin",
        command_exists=lambda command: command == "open",
        path_exists=lambda _: False,
    )
    assert plan.detected_environment == "ssh"
    assert plan.launch_mode == "macos"
    assert plan.launch_supported is True
    assert plan.commands == [["open", "http://0.0.0.0:4312/s/demo/"]]
    assert plan.hint == "ssh -L 127.0.0.1:4312:127.0.0.1:4312 <ssh-host> -N"

    ipv6_hint = cli_module._ssh_tunnel_hint("http://[::1]:9000/s/demo/")
    assert ipv6_hint == "ssh -L 127.0.0.1:9000:[::1]:9000 <ssh-host> -N"


def test_wsl_launcher_fallback_tries_multiple_backends() -> None:
    plan = cli_module._plan_view_launch(
        url="http://127.0.0.1:4312/s/demo/",
        open_policy="auto",
        env={"WSL_INTEROP": "1"},
        platform_name="linux",
        command_exists=lambda command: command in {"wslview", "powershell.exe", "cmd.exe"},
        path_exists=lambda _: False,
    )
    assert plan.detected_environment == "wsl"
    assert [command[0] for command in plan.commands] == [
        "wslview",
        "powershell.exe",
        "cmd.exe",
    ]

    attempts: list[list[str]] = []

    class Completed:
        def __init__(self, returncode: int) -> None:
            self.returncode = returncode

    def fake_run(command: list[str], **_: object) -> Completed:
        attempts.append(command)
        if command[0] == "wslview":
            return Completed(1)
        return Completed(0)

    result = cli_module._execute_view_launch_plan(plan, run_command=fake_run)
    assert [command[0] for command in attempts] == ["wslview", "powershell.exe"]
    assert result.open_attempted is True
    assert result.open_succeeded is True
    assert result.launcher == "powershell.exe"


def test_view_plan_reports_relative_url_and_missing_launcher() -> None:
    relative_plan = cli_module._plan_view_launch(
        url="/s/demo/",
        open_policy="auto",
        env={},
        platform_name="linux",
        command_exists=lambda _: False,
        path_exists=lambda _: False,
    )
    assert relative_plan.launch_supported is False
    assert relative_plan.warning == "Viewer URL is relative because no healthy server is running"

    mac_plan = cli_module._plan_view_launch(
        url="http://127.0.0.1:4312/s/demo/",
        open_policy="auto",
        env={},
        platform_name="darwin",
        command_exists=lambda _: False,
        path_exists=lambda _: False,
    )
    result = cli_module._view_launch_result(mac_plan)
    assert result.launch_supported is False
    assert result.warning == "No supported browser launcher was detected for this environment"


def test_env_defaults_apply_for_start_when_cli_omitted(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime-env-defaults"
    env = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_HOST": "127.0.0.1",
        "LOCALHOST_LIVE_PORT": "0",
        "LOCALHOST_LIVE_IDLE_TIMEOUT": "123",
    }
    try:
        start = _run_module_command(["start", "--json"], env=env)
        assert start.returncode == 0, start.stderr
        payload = json.loads(start.stdout)
        assert payload["ok"] is True
        assert payload["host"] == "127.0.0.1"
        assert int(payload["port"]) > 0
        assert payload["idle_timeout_seconds"] == 123
        assert payload["server_metadata_path"] == str(runtime_root / "server.json")
    finally:
        _run_module_command(["stop", "--json"], env=env)
        _stop_server_from_runtime(runtime_root)


def test_cli_overrides_env_defaults_for_start_and_view(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime-env-override"
    source = tmp_path / "index.html"
    source.write_text("<html>override</html>", encoding="utf-8")
    start_env = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_PORT": "not-an-int",
    }
    env = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_PORT": "0",
        "LOCALHOST_LIVE_OPEN": "never",
    }
    try:
        start = _run_module_command(["start", "--port", "0", "--json"], env=start_env)
        assert start.returncode == 0, start.stderr
        start_payload = json.loads(start.stdout)
        assert int(start_payload["port"]) > 0

        create = _run_module_command(
            ["session", "create", "--from", str(source), "--json"],
            env=env,
        )
        assert create.returncode == 0, create.stderr
        session_id = json.loads(create.stdout)["session_id"]

        view = _run_module_command(
            ["view", session_id, "--open", "auto", "--json"],
            env=env,
        )
        assert view.returncode == 0, view.stderr
        view_payload = json.loads(view.stdout)
        assert view_payload["open_policy"] == "auto"
    finally:
        _run_module_command(["stop", "--json"], env=env)
        _stop_server_from_runtime(runtime_root)


def test_no_start_env_boolean_default_and_cli_override(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime-no-start-env"
    source = tmp_path / "index.html"
    source.write_text("<html>no-start</html>", encoding="utf-8")
    create = _run_module_command(
        ["--runtime-root", str(runtime_root), "session", "create", "--from", str(source), "--json"]
    )
    assert create.returncode == 0, create.stderr
    session_id = json.loads(create.stdout)["session_id"]
    stop = _run_module_command(["--runtime-root", str(runtime_root), "stop", "--json"])
    assert stop.returncode == 0, stop.stderr

    env_true = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_NO_START": "ON",
    }
    view_env_default = _run_module_command(["view", session_id, "--json"], env=env_true)
    assert view_env_default.returncode == 0, view_env_default.stderr
    payload_default = json.loads(view_env_default.stdout)
    assert payload_default["viewer_url"] == f"/s/{session_id}/"

    env_false = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_NO_START": "0",
    }
    view_cli_override = _run_module_command(
        ["--no-start", "view", session_id, "--json"],
        env=env_false,
    )
    assert view_cli_override.returncode == 0, view_cli_override.stderr
    payload_override = json.loads(view_cli_override.stdout)
    assert payload_override["viewer_url"] == f"/s/{session_id}/"
    assert payload_override["open_attempted"] is False


def test_view_open_policy_env_default_and_invalid_env_errors(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime-open-env"
    source = tmp_path / "index.html"
    source.write_text("<html>open-env</html>", encoding="utf-8")
    create = _run_module_command(
        ["--runtime-root", str(runtime_root), "session", "create", "--from", str(source), "--json"]
    )
    assert create.returncode == 0, create.stderr
    session_id = json.loads(create.stdout)["session_id"]

    env_open_default = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_OPEN": "never",
    }
    view_default = _run_module_command(["view", session_id, "--json"], env=env_open_default)
    assert view_default.returncode == 0, view_default.stderr
    assert json.loads(view_default.stdout)["open_policy"] == "never"

    env_open_always = {
        "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
        "LOCALHOST_LIVE_OPEN": "always",
    }
    view_json_open_always = _run_module_command(
        ["view", session_id, "--json"], env=env_open_always
    )
    assert view_json_open_always.returncode == 0, view_json_open_always.stderr
    view_json_payload = json.loads(view_json_open_always.stdout)
    assert view_json_payload["open_policy"] == "always"
    assert view_json_payload["open_attempted"] is False
    assert view_json_payload["open_succeeded"] is False

    healthy_with_invalid_startup_env = _run_module_command(
        ["view", session_id, "--json"],
        env={
            "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
            "LOCALHOST_LIVE_PORT": "nan",
        },
    )
    assert healthy_with_invalid_startup_env.returncode == 0, healthy_with_invalid_startup_env.stderr
    healthy_payload = json.loads(healthy_with_invalid_startup_env.stdout)
    assert healthy_payload["viewer_url"].startswith("http://127.0.0.1:")

    invalid_open = _run_module_command(
        ["view", session_id, "--json"],
        env={
            "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
            "LOCALHOST_LIVE_OPEN": "later",
        },
    )
    assert invalid_open.returncode != 0
    assert "LOCALHOST_LIVE_OPEN" in invalid_open.stderr

    invalid_port = _run_module_command(
        ["start", "--json"],
        env={
            "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
            "LOCALHOST_LIVE_PORT": "nan",
        },
    )
    assert invalid_port.returncode != 0
    assert "LOCALHOST_LIVE_PORT" in invalid_port.stderr

    invalid_no_start_on_view = _run_module_command(
        ["view", session_id, "--json"],
        env={
            "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
            "LOCALHOST_LIVE_NO_START": "maybe",
        },
    )
    assert invalid_no_start_on_view.returncode != 0
    assert "LOCALHOST_LIVE_NO_START" in invalid_no_start_on_view.stderr

    unaffected = _run_module_command(
        ["status", "--json"],
        env={
            "LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root),
            "LOCALHOST_LIVE_PORT": "nan",
            "LOCALHOST_LIVE_NO_START": "maybe",
        },
    )
    assert unaffected.returncode == 0, unaffected.stderr
    assert "session_count" in json.loads(unaffected.stdout)
    _stop_server_from_runtime(runtime_root)


def test_start_rejects_empty_cli_host(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime-empty-host"
    result = _run_module_command(
        ["start", "--host", "", "--json"],
        env={"LOCALHOST_LIVE_RUNTIME_ROOT": str(runtime_root)},
    )
    assert result.returncode != 0
    assert "Invalid --host" in result.stderr
