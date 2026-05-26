from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from localhost_live.jsonio import atomic_write_json, read_json
from localhost_live.metadata import (
    SCHEMA_VERSION,
    build_server_metadata,
    build_session_metadata,
    build_source_metadata,
    build_state_metadata,
)
from localhost_live.runtime import (
    control_token_path,
    ensure_control_token,
    generate_control_token,
    resolve_runtime_root,
    server_metadata_path,
)


def test_default_runtime_root_resolution_behavior(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    xdg_root = tmp_path / "xdg"
    tmpdir_root = tmp_path / "tmpdir"

    monkeypatch.setenv("XDG_RUNTIME_DIR", str(xdg_root))
    monkeypatch.setenv("TMPDIR", str(tmpdir_root))
    assert (
        resolve_runtime_root()
        == xdg_root / "shmitabilities-live" / "localhost-live"
    )

    monkeypatch.delenv("XDG_RUNTIME_DIR")
    assert (
        resolve_runtime_root()
        == tmpdir_root / "shmitabilities-live" / "localhost-live"
    )

    monkeypatch.delenv("TMPDIR")
    assert resolve_runtime_root() == Path("/tmp/shmitabilities-live/localhost-live")


def test_explicit_runtime_root_override_behavior(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path / "ignored-xdg"))
    override = tmp_path / "custom-runtime-root"

    assert resolve_runtime_root(override) == override


def test_atomic_json_write_success(tmp_path: Path) -> None:
    target = tmp_path / "payload.json"
    payload = {"hello": "world", "value": 7}

    atomic_write_json(target, payload)

    assert read_json(target) == payload


def test_atomic_json_write_failure_no_partial_target_content(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    target = tmp_path / "payload.json"
    original = {"keep": "original"}
    atomic_write_json(target, original)

    def fail_replace(_src: str, _dst: str) -> None:
        raise OSError("simulated replace failure")

    monkeypatch.setattr("localhost_live.jsonio.os.replace", fail_replace)

    with pytest.raises(OSError, match="simulated replace failure"):
        atomic_write_json(target, {"keep": "new"})

    assert json.loads(target.read_text(encoding="utf-8")) == original
    assert list(tmp_path.glob("payload.json.*.tmp")) == []


def test_control_token_entropy_format_and_runtime_path_placement(
    tmp_path: Path,
) -> None:
    generated = {generate_control_token() for _ in range(64)}
    assert len(generated) == 64
    assert all(re.fullmatch(r"[0-9a-f]{64}", token) for token in generated)

    runtime_root = tmp_path / "runtime"
    token_file = control_token_path(runtime_root)
    server_file = server_metadata_path(runtime_root)
    assert token_file == runtime_root / "control.token"
    assert server_file == runtime_root / "server.json"
    assert "sessions" not in token_file.parts
    assert "sessions" not in server_file.parts

    stored = ensure_control_token(runtime_root)
    assert re.fullmatch(r"[0-9a-f]{64}", stored)
    assert token_file.read_text(encoding="utf-8").strip() == stored


def test_metadata_helpers_include_schema_version_fields(tmp_path: Path) -> None:
    source = build_source_metadata(
        source_kind="file",
        original_path=str(tmp_path / "index.html"),
        entry="index.html",
        imported_at="2026-05-26T10:00:00Z",
    )
    state = build_state_metadata(
        state_id="000001",
        entry="index.html",
        created_at="2026-05-26T10:01:00Z",
        source=source,
    )
    session = build_session_metadata(
        session_id="abc123",
        created_at="2026-05-26T10:02:00Z",
        title="Demo",
    )
    server = build_server_metadata(
        host="127.0.0.1",
        port=8123,
        pid=12345,
        idle_timeout_seconds=300,
        token_path=str(tmp_path / "runtime" / "control.token"),
        started_at="2026-05-26T10:03:00Z",
    )

    assert source["schema_version"] == SCHEMA_VERSION
    assert state["schema_version"] == SCHEMA_VERSION
    assert session["schema_version"] == SCHEMA_VERSION
    assert server["schema_version"] == SCHEMA_VERSION
