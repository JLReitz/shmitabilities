"""Argparse-based CLI scaffold for localhost-live."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Sequence
from urllib.parse import urlsplit

from localhost_live.importer import ImportRejectedError
from localhost_live.registry import (
    InvalidSessionIdError,
    SessionNotFoundError,
    SessionRegistry,
)
from localhost_live.replay import export_replay_archive, save_replay_artifact
from localhost_live.runtime import server_metadata_path
from localhost_live.server import (
    DEFAULT_HOST,
    DEFAULT_IDLE_TIMEOUT_SECONDS,
    DEFAULT_PORT,
    ServerUnavailableError,
    control_post_json,
    discover_healthy_server,
    ensure_healthy_server,
    parse_serve_args,
    read_control_token,
    run_server_process,
)

ENV_RUNTIME_ROOT = "LOCALHOST_LIVE_RUNTIME_ROOT"
ENV_NO_START = "LOCALHOST_LIVE_NO_START"
ENV_HOST = "LOCALHOST_LIVE_HOST"
ENV_PORT = "LOCALHOST_LIVE_PORT"
ENV_IDLE_TIMEOUT = "LOCALHOST_LIVE_IDLE_TIMEOUT"
ENV_OPEN = "LOCALHOST_LIVE_OPEN"

_TRUE_ENV_VALUES = {"1", "true", "yes", "on"}
_FALSE_ENV_VALUES = {"0", "false", "no", "off"}
_OPEN_POLICIES = {"auto", "always", "never"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="localhost-live",
        description="Localhost live-view CLI (Step 1 scaffold).",
    )
    parser.add_argument(
        "--runtime-root",
        default=argparse.SUPPRESS,
        help="Override runtime root path (useful for tests and isolated runs).",
    )
    parser.add_argument(
        "--no-start",
        action="store_true",
        default=argparse.SUPPRESS,
        help="Do not auto-start a server if none is healthy.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    start_parser = subparsers.add_parser("start", help="Start the local service.")
    start_parser.add_argument(
        "--host",
        default=argparse.SUPPRESS,
        help="Bind host.",
    )
    start_parser.add_argument(
        "--port",
        type=int,
        default=argparse.SUPPRESS,
        help="Bind port.",
    )
    start_parser.add_argument(
        "--idle-timeout",
        type=int,
        default=argparse.SUPPRESS,
        help="Idle timeout in seconds (metadata field for lifecycle management).",
    )
    start_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    start_parser.set_defaults(handler=_handle_start)

    serve_parser = subparsers.add_parser("_serve", help=argparse.SUPPRESS)
    serve_parser.add_argument("--host", required=True)
    serve_parser.add_argument("--port", required=True)
    serve_parser.add_argument("--idle-timeout", required=True)
    serve_parser.set_defaults(handler=_handle_serve)

    session_parser = subparsers.add_parser("session", help="Session operations.")
    session_subparsers = session_parser.add_subparsers(dest="session_command", required=True)
    session_create_parser = session_subparsers.add_parser(
        "create", help="Create a new session."
    )
    session_create_parser.add_argument("--title", help="Optional session title.")
    session_create_parser.add_argument(
        "--from",
        dest="source",
        help="Source FILE or DIR for initial session state snapshot.",
    )
    session_create_parser.add_argument(
        "--entry",
        default="index.html",
        help="Entry document path inside imported content (default: index.html).",
    )
    session_create_parser.add_argument(
        "--json", action="store_true", help="Emit JSON output."
    )
    session_create_parser.set_defaults(handler=_handle_session_create)

    push_parser = subparsers.add_parser("push", help="Push state into a session.")
    push_parser.add_argument("session_id", help="Session identifier.")
    push_parser.add_argument(
        "--from",
        dest="source",
        required=True,
        help="Source FILE or DIR for the state snapshot.",
    )
    push_parser.add_argument(
        "--entry",
        default="index.html",
        help="Entry document path inside imported content (default: index.html).",
    )
    push_parser.add_argument(
        "--replace-latest",
        action="store_true",
        help="Replace only the latest state in-place.",
    )
    push_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    push_parser.set_defaults(handler=_handle_push)

    status_parser = subparsers.add_parser("status", help="Show runtime/session status.")
    status_parser.add_argument("session_id", nargs="?", help="Optional session identifier.")
    status_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    status_parser.set_defaults(handler=_handle_status)

    url_parser = subparsers.add_parser("url", help="Print viewer URL for a session.")
    url_parser.add_argument("session_id", help="Session identifier.")
    url_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    url_parser.set_defaults(handler=_handle_url)

    view_parser = subparsers.add_parser(
        "view", help="Print and optionally open the viewer URL for a session."
    )
    view_parser.add_argument("session_id", help="Session identifier.")
    view_parser.add_argument(
        "--open",
        dest="open_policy",
        choices=("auto", "always", "never"),
        default=argparse.SUPPRESS,
        help="Open policy for local viewer launch (default: auto).",
    )
    view_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    view_parser.set_defaults(handler=_handle_view)

    save_parser = subparsers.add_parser("save", help="Save a replayable session artifact.")
    save_parser.add_argument("session_id", help="Session identifier.")
    save_parser.add_argument("--to", required=True, help="Destination directory path.")
    save_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite destination if it already exists and is non-empty.",
    )
    save_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    save_parser.set_defaults(handler=_handle_save)

    export_parser = subparsers.add_parser("export", help="Export session archive.")
    export_parser.add_argument("session_id", help="Session identifier.")
    export_parser.add_argument("--to", required=True, help="Destination .zip file path.")
    export_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite destination file if it already exists.",
    )
    export_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    export_parser.set_defaults(handler=_handle_export)

    stop_parser = subparsers.add_parser("stop", help="Stop the local service.")
    stop_parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    stop_parser.set_defaults(handler=_handle_stop)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        _apply_env_defaults(args)
        handler = getattr(args, "handler", None)
        if handler is None:
            parser.print_help()
            return 2
        return int(handler(args))
    except ImportRejectedError as exc:
        diagnostics = ", ".join(exc.diagnostics) if exc.diagnostics else str(exc)
        return _emit_error(diagnostics, args)
    except (
        SessionNotFoundError,
        InvalidSessionIdError,
        FileNotFoundError,
        ValueError,
        ServerUnavailableError,
    ) as exc:
        return _emit_error(str(exc), args)


def _emit(args: argparse.Namespace, payload: dict[str, object], text: str) -> int:
    if getattr(args, "json", False):
        sys.stdout.write(json.dumps(payload))
        sys.stdout.write("\n")
        return 0
    sys.stdout.write(f"{text}\n")
    return 0


def _emit_error(message: str, args: argparse.Namespace | None = None) -> int:
    del args
    sys.stderr.write(f"error: {message}\n")
    return 1


def _registry_from_args(args: argparse.Namespace) -> SessionRegistry:
    return SessionRegistry(runtime_root=args.runtime_root)


def _apply_env_defaults(args: argparse.Namespace, *, env: dict[str, str] | None = None) -> None:
    current_env = os.environ if env is None else env
    _apply_runtime_root_default(args, env=current_env)
    if _command_supports_no_start(args):
        _apply_no_start_default(args, env=current_env)
    if getattr(args, "command", None) == "start":
        _apply_startup_defaults(args, env=current_env)
    if getattr(args, "command", None) == "view":
        _apply_open_policy_default(args, env=current_env)


def _apply_runtime_root_default(args: argparse.Namespace, *, env: dict[str, str]) -> None:
    if hasattr(args, "runtime_root"):
        return
    raw = env.get(ENV_RUNTIME_ROOT)
    if raw is None:
        args.runtime_root = None
        return
    value = raw.strip()
    if not value:
        raise ValueError(f"Invalid {ENV_RUNTIME_ROOT}: expected non-empty path")
    args.runtime_root = value


def _apply_no_start_default(args: argparse.Namespace, *, env: dict[str, str]) -> None:
    if hasattr(args, "no_start"):
        return
    raw = env.get(ENV_NO_START)
    if raw is None:
        args.no_start = False
        return
    normalized = raw.strip().lower()
    if normalized in _TRUE_ENV_VALUES:
        args.no_start = True
        return
    if normalized in _FALSE_ENV_VALUES:
        args.no_start = False
        return
    raise ValueError(
        f"Invalid {ENV_NO_START}: expected one of "
        "'1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'"
    )


def _apply_startup_defaults(args: argparse.Namespace, *, env: dict[str, str]) -> None:
    if hasattr(args, "host"):
        value = str(args.host).strip()
        if not value:
            raise ValueError("Invalid --host: expected non-empty host")
        args.host = value
    else:
        args.host = _resolve_host_default(env)
    if not hasattr(args, "port"):
        args.port = _resolve_port_default(env)
    if not hasattr(args, "idle_timeout"):
        args.idle_timeout = _resolve_idle_timeout_default(env)


def _resolve_host_default(env: dict[str, str]) -> str:
    raw = env.get(ENV_HOST)
    if raw is None:
        return DEFAULT_HOST
    value = raw.strip()
    if not value:
        raise ValueError(f"Invalid {ENV_HOST}: expected non-empty host")
    return value


def _resolve_port_default(env: dict[str, str]) -> int:
    raw = env.get(ENV_PORT)
    if raw is None:
        return int(DEFAULT_PORT)
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"Invalid {ENV_PORT}: expected integer, got {raw!r}") from exc
    if value < 0 or value > 65535:
        raise ValueError(f"Invalid {ENV_PORT}: expected value in range 0..65535")
    return value


def _resolve_idle_timeout_default(env: dict[str, str]) -> int:
    raw = env.get(ENV_IDLE_TIMEOUT)
    if raw is None:
        return int(DEFAULT_IDLE_TIMEOUT_SECONDS)
    try:
        value = int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"Invalid {ENV_IDLE_TIMEOUT}: expected integer, got {raw!r}") from exc
    if value <= 0:
        raise ValueError(f"Invalid {ENV_IDLE_TIMEOUT}: expected integer > 0")
    return value


def _apply_open_policy_default(args: argparse.Namespace, *, env: dict[str, str]) -> None:
    if hasattr(args, "open_policy"):
        return
    raw = env.get(ENV_OPEN)
    if raw is None:
        args.open_policy = "auto"
        return
    value = raw.strip().lower()
    if value not in _OPEN_POLICIES:
        raise ValueError(
            f"Invalid {ENV_OPEN}: expected one of 'auto', 'always', 'never'"
        )
    args.open_policy = value


def _command_supports_no_start(args: argparse.Namespace) -> bool:
    command = getattr(args, "command", None)
    if command in {"push", "view"}:
        return True
    if command == "session" and getattr(args, "session_command", None) == "create":
        return True
    return False


def _session_viewer_url(registry: SessionRegistry, session_id: str) -> str:
    route_relative = f"/s/{session_id}/"
    server = discover_healthy_server(registry.runtime_root)
    if server is None:
        return route_relative
    host = str(server["host"])
    port = int(server["port"])
    return f"http://{host}:{port}{route_relative}"


def _handle_start(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    metadata, started = ensure_healthy_server(
        runtime_root=registry.runtime_root,
        host=str(args.host),
        port=int(args.port),
        idle_timeout_seconds=int(args.idle_timeout),
        no_start=False,
    )
    payload = {
        "ok": True,
        "command": "start",
        "started": started,
        "host": metadata["host"],
        "port": metadata["port"],
        "pid": metadata["pid"],
        "idle_timeout_seconds": metadata["idle_timeout_seconds"],
        "token_path": metadata["token_path"],
        "server_metadata_path": str(server_metadata_path(registry.runtime_root)),
    }
    return _emit(args, payload, f"http://{metadata['host']}:{metadata['port']}/")


def _handle_serve(args: argparse.Namespace) -> int:
    runtime_root, host, port, idle_timeout_seconds = parse_serve_args(args)
    run_server_process(
        runtime_root=runtime_root,
        host=host,
        port=port,
        idle_timeout_seconds=idle_timeout_seconds,
    )
    return 0


def _handle_session_create(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    server = _ensure_server_for_command(args, registry)
    created = _call_control_route(
        registry=registry,
        server=server,
        route="/control/session/create",
        payload={
            "title": args.title,
            "source": args.source,
            "entry": args.entry,
        },
    )
    session_id = str(created["session_id"])
    viewer_url = _session_viewer_url(registry, session_id)
    payload: dict[str, object] = {
        "session_id": session_id,
        "state_count": int(created["state_count"]),
        "manifest_path": str(created["manifest_path"]),
        "viewer_url": viewer_url,
    }
    return _emit(args, payload, f"session {session_id} created")


def _handle_push(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    server = _ensure_server_for_command(args, registry)
    pushed = _call_control_route(
        registry=registry,
        server=server,
        route="/control/push",
        payload={
            "session_id": args.session_id,
            "source": args.source,
            "entry": args.entry,
            "replace_latest": bool(args.replace_latest),
        },
    )
    payload: dict[str, object] = {
        "session_id": str(pushed["session_id"]),
        "state_id": str(pushed["state_id"]),
        "entry": str(pushed["entry"]),
        "state_url": str(pushed["state_url"]),
        "viewer_url": _session_viewer_url(registry, str(pushed["session_id"])),
        "manifest_path": str(pushed["manifest_path"]),
        "source": pushed.get("source"),
        "replaced_latest": bool(pushed.get("replaced_latest", False)),
    }
    return _emit(args, payload, f"pushed state {payload['state_id']}")


def _handle_status(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    server = discover_healthy_server(registry.runtime_root)
    if args.session_id:
        manifest = registry.load_manifest(args.session_id)
        session_id = str(manifest["session_id"])
        payload: dict[str, object] = {
            "runtime_root": str(registry.runtime_root),
            "session_id": session_id,
            "state_count": int(manifest["state_count"]),
            "latest_state_id": manifest["latest_state_id"],
            "manifest_path": str(registry.session_root(session_id) / "manifest.json"),
            "viewer_url": _session_viewer_url(registry, session_id),
            "states": manifest["states"],
            "server": server,
        }
        return _emit(args, payload, f"session {session_id}: {manifest['state_count']} states")

    sessions_root = registry.runtime_root / "sessions"
    summaries: list[dict[str, object]] = []
    if sessions_root.exists():
        for path in sorted(p for p in sessions_root.iterdir() if p.is_dir()):
            session_id = path.name
            try:
                manifest = registry.load_manifest(session_id)
            except (SessionNotFoundError, InvalidSessionIdError, ValueError):
                continue
            summaries.append(
                {
                    "session_id": session_id,
                    "state_count": int(manifest["state_count"]),
                    "latest_state_id": manifest["latest_state_id"],
                    "manifest_path": str(path / "manifest.json"),
                    "viewer_url": _session_viewer_url(registry, session_id),
                }
            )
    payload = {
        "runtime_root": str(registry.runtime_root),
        "session_count": len(summaries),
        "sessions": summaries,
        "server": server,
    }
    return _emit(args, payload, f"{len(summaries)} sessions")


def _handle_url(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    registry.load_manifest(args.session_id)
    url = _session_viewer_url(registry, args.session_id)
    return _emit(args, {"session_id": args.session_id, "viewer_url": url}, url)


def _handle_view(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    registry.load_manifest(args.session_id)
    if not bool(args.no_start):
        _ensure_server_for_command(args, registry)
    url = _session_viewer_url(registry, args.session_id)
    launch_plan = _plan_view_launch(
        url=url,
        open_policy=str(args.open_policy),
    )
    launch_result = _view_launch_result(launch_plan)
    payload = {
        "ok": True,
        "command": "view",
        "session_id": args.session_id,
        "viewer_url": url,
        "open_policy": str(args.open_policy),
        **launch_result.payload(),
    }
    if getattr(args, "json", False):
        return _emit(args, payload, url)
    sys.stdout.write(f"{url}\n")
    sys.stdout.flush()
    executed = _execute_view_launch_plan(launch_plan)
    _emit_view_text_feedback(executed)
    return 0


def _handle_save(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    saved = save_replay_artifact(
        registry=registry,
        session_id=args.session_id,
        destination=args.to,
        force=bool(args.force),
    )
    return _emit(
        args,
        {
            "ok": True,
            "command": "save",
            "session_id": saved.session_id,
            "destination": str(saved.destination),
            "state_count": saved.state_count,
            "index_path": str(saved.index_path),
            "manifest_path": str(saved.manifest_path),
        },
        f"saved {saved.state_count} states to {saved.destination}",
    )


def _handle_export(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    exported = export_replay_archive(
        registry=registry,
        session_id=args.session_id,
        destination=args.to,
        force=bool(args.force),
    )
    return _emit(
        args,
        {
            "ok": True,
            "command": "export",
            "session_id": exported.session_id,
            "destination": str(exported.destination),
            "state_count": exported.state_count,
            "index_path": exported.index_path,
            "manifest_path": exported.manifest_path,
        },
        f"exported {exported.state_count} states to {exported.destination}",
    )


def _handle_stop(args: argparse.Namespace) -> int:
    registry = _registry_from_args(args)
    server = discover_healthy_server(registry.runtime_root)
    if server is None:
        return _emit(args, {"ok": True, "command": "stop", "stopped": False}, "no server")
    result = _call_control_route(
        registry=registry,
        server=server,
        route="/control/stop",
        payload={},
    )
    return _emit(
        args,
        {"ok": True, "command": "stop", "stopped": bool(result.get("stopping", True))},
        "server stopping",
    )


def _ensure_server_for_command(
    args: argparse.Namespace, registry: SessionRegistry
) -> dict[str, Any]:
    existing = discover_healthy_server(registry.runtime_root)
    if existing is not None:
        return existing

    if bool(args.no_start):
        server, _started = ensure_healthy_server(
            runtime_root=registry.runtime_root,
            host=DEFAULT_HOST,
            port=int(DEFAULT_PORT),
            idle_timeout_seconds=int(DEFAULT_IDLE_TIMEOUT_SECONDS),
            no_start=True,
        )
        return server

    env = os.environ
    host = str(args.host) if hasattr(args, "host") else _resolve_host_default(env)
    port = int(args.port) if hasattr(args, "port") else _resolve_port_default(env)
    idle_timeout_seconds = (
        int(args.idle_timeout)
        if hasattr(args, "idle_timeout")
        else _resolve_idle_timeout_default(env)
    )
    server, _started = ensure_healthy_server(
        runtime_root=registry.runtime_root,
        host=host,
        port=port,
        idle_timeout_seconds=idle_timeout_seconds,
        no_start=False,
    )
    return server


def _call_control_route(
    *,
    registry: SessionRegistry,
    server: dict[str, Any],
    route: str,
    payload: dict[str, object],
) -> dict[str, Any]:
    token = read_control_token(registry.runtime_root)
    host = str(server["host"])
    port = int(server["port"])
    result = control_post_json(
        runtime_root=registry.runtime_root,
        host=host,
        port=port,
        route=route,
        payload=payload,
        token=token,
    )
    if not isinstance(result, dict):
        raise ValueError(f"Invalid control response for {route}")
    return result


@dataclass(frozen=True)
class ViewLaunchPlan:
    detected_environment: str
    launch_mode: str
    launch_supported: bool
    launcher: str | None
    commands: list[list[str]] = field(default_factory=list, repr=False)
    hint: str | None = None
    warning: str | None = None


@dataclass(frozen=True)
class ViewLaunchResult:
    detected_environment: str
    launch_mode: str
    launch_supported: bool
    launcher: str | None
    open_attempted: bool
    open_succeeded: bool
    hint: str | None = None
    warning: str | None = None

    def payload(self) -> dict[str, object]:
        return {
            "detected_environment": self.detected_environment,
            "launch_mode": self.launch_mode,
            "launcher": self.launcher,
            "launch_supported": self.launch_supported,
            "open_attempted": self.open_attempted,
            "open_succeeded": self.open_succeeded,
            "hint": self.hint,
            "warning": self.warning,
        }


def _plan_view_launch(
    *,
    url: str,
    open_policy: str,
    env: dict[str, str] | None = None,
    platform_name: str | None = None,
    command_exists: Any | None = None,
    path_exists: Any | None = None,
) -> ViewLaunchPlan:
    environment = _detect_view_environment(
        env=env,
        platform_name=platform_name,
        path_exists=path_exists,
    )
    if not _is_absolute_view_url(url):
        return ViewLaunchPlan(
            detected_environment=environment,
            launch_mode="print-only",
            launch_supported=False,
            launcher=None,
            warning="Viewer URL is relative because no healthy server is running",
        )
    if open_policy == "never":
        return ViewLaunchPlan(
            detected_environment=environment,
            launch_mode="print-only",
            launch_supported=False,
            launcher=None,
            hint=_ssh_tunnel_hint(url) if environment == "ssh" else None,
        )
    if environment == "ssh" and open_policy == "auto":
        return ViewLaunchPlan(
            detected_environment=environment,
            launch_mode="ssh",
            launch_supported=False,
            launcher=None,
            hint=_ssh_tunnel_hint(url),
        )

    launch_environment = _launch_backend_environment(
        detected_environment=environment,
        env=env,
        platform_name=platform_name,
        path_exists=path_exists,
        open_policy=open_policy,
    )
    commands = _view_launcher_commands(
        environment=launch_environment,
        url=url,
        env=env,
        command_exists=command_exists or _command_exists,
    )
    if not commands:
        warning = None
        if open_policy == "always":
            warning = "No supported browser launcher was detected for this environment"
        elif environment not in {"ssh", "print-only"}:
            warning = "No supported browser launcher was detected for this environment"
        return ViewLaunchPlan(
            detected_environment=environment,
            launch_mode="print-only",
            launch_supported=False,
            launcher=None,
            hint=_ssh_tunnel_hint(url) if environment == "ssh" else None,
            warning=warning,
        )
    return ViewLaunchPlan(
        detected_environment=environment,
        launch_mode=launch_environment,
        launch_supported=True,
        launcher=commands[0][0],
        commands=commands,
        hint=_ssh_tunnel_hint(url) if environment == "ssh" else None,
    )


def _view_launch_result(plan: ViewLaunchPlan) -> ViewLaunchResult:
    return ViewLaunchResult(
        detected_environment=plan.detected_environment,
        launch_mode=plan.launch_mode,
        launch_supported=plan.launch_supported,
        launcher=plan.launcher,
        open_attempted=False,
        open_succeeded=False,
        hint=plan.hint,
        warning=plan.warning,
    )


def _execute_view_launch_plan(
    plan: ViewLaunchPlan,
    *,
    run_command: Any | None = None,
) -> ViewLaunchResult:
    if not plan.launch_supported or not plan.commands:
        return _view_launch_result(plan)

    runner = run_command or subprocess.run
    warnings: list[str] = []
    for command in plan.commands:
        try:
            completed = runner(
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            warnings.append(f"{command[0]}: {exc}")
            continue
        if int(completed.returncode) == 0:
            return ViewLaunchResult(
                detected_environment=plan.detected_environment,
                launch_mode=plan.launch_mode,
                launch_supported=True,
                launcher=command[0],
                open_attempted=True,
                open_succeeded=True,
                hint=plan.hint,
                warning=plan.warning,
            )
        warnings.append(f"{command[0]} exited with status {completed.returncode}")
    return ViewLaunchResult(
        detected_environment=plan.detected_environment,
        launch_mode=plan.launch_mode,
        launch_supported=True,
        launcher=plan.launcher,
        open_attempted=True,
        open_succeeded=False,
        hint=plan.hint,
        warning="; ".join(warnings),
    )


def _emit_view_text_feedback(result: ViewLaunchResult) -> None:
    if result.hint:
        sys.stdout.write(f"{result.hint}\n")
    if result.warning:
        sys.stderr.write(f"warning: {result.warning}\n")


def _detect_view_environment(
    *,
    env: dict[str, str] | None = None,
    platform_name: str | None = None,
    path_exists: Any | None = None,
) -> str:
    current_env = os.environ if env is None else env
    if current_env.get("SSH_CONNECTION"):
        return "ssh"
    if _is_wsl(env=current_env, path_exists=path_exists):
        return "wsl"
    current_platform = sys.platform if platform_name is None else platform_name
    if current_platform == "darwin":
        return "macos"
    if current_platform.startswith("linux") and _has_linux_gui_session(current_env):
        return "linux-gui"
    return "print-only"


def _is_wsl(
    *,
    env: dict[str, str],
    path_exists: Any | None = None,
) -> bool:
    if env.get("WSL_INTEROP") or env.get("WSL_DISTRO_NAME"):
        return True
    exists = path_exists or os.path.exists
    return any(
        exists(marker)
        for marker in (
            "/run/WSL",
            "/proc/sys/fs/binfmt_misc/WSLInterop",
        )
    )


def _has_linux_gui_session(env: dict[str, str]) -> bool:
    return bool(env.get("DISPLAY") or env.get("WAYLAND_DISPLAY"))


def _launch_backend_environment(
    *,
    detected_environment: str,
    env: dict[str, str] | None = None,
    platform_name: str | None = None,
    path_exists: Any | None = None,
    open_policy: str,
) -> str:
    if detected_environment != "ssh" or open_policy != "always":
        return detected_environment
    current_env = os.environ if env is None else env
    if _is_wsl(env=current_env, path_exists=path_exists):
        return "wsl"
    current_platform = sys.platform if platform_name is None else platform_name
    if current_platform == "darwin":
        return "macos"
    if current_platform.startswith("linux") and _has_linux_gui_session(current_env):
        return "linux-gui"
    return "print-only"


def _command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def _view_launcher_commands(
    *,
    environment: str,
    url: str,
    env: dict[str, str] | None,
    command_exists: Any,
) -> list[list[str]]:
    current_env = os.environ if env is None else env
    if environment == "wsl":
        commands: list[list[str]] = []
        if command_exists("wslview"):
            commands.append(["wslview", url])
        if command_exists("powershell.exe"):
            commands.append(
                [
                    "powershell.exe",
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    f"Start-Process '{url}'",
                ]
            )
        if command_exists("cmd.exe"):
            commands.append(["cmd.exe", "/c", "start", "", url])
        if command_exists("explorer.exe"):
            commands.append(["explorer.exe", url])
        if _has_linux_gui_session(current_env) and command_exists("xdg-open"):
            commands.append(["xdg-open", url])
        return commands
    if environment == "macos" and command_exists("open"):
        return [["open", url]]
    if environment == "linux-gui" and command_exists("xdg-open"):
        return [["xdg-open", url]]
    return []


def _ssh_tunnel_hint(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.port is None:
        return ""
    port = parsed.port
    target_host = parsed.hostname or "127.0.0.1"
    if target_host in {"0.0.0.0", "::"}:
        target_host = "127.0.0.1"
    if ":" in target_host and not target_host.startswith("["):
        target_host = f"[{target_host}]"
    return f"ssh -L 127.0.0.1:{port}:{target_host}:{port} <ssh-host> -N"


def _is_absolute_view_url(url: str) -> bool:
    parsed = urlsplit(url)
    return bool(parsed.scheme and parsed.netloc)
