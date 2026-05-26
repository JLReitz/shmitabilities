"""Replay artifact staging and save helpers."""

from __future__ import annotations

import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any

from localhost_live.jsonio import atomic_write_json, atomic_write_text, read_json
from localhost_live.registry import SessionRegistry
from localhost_live.server import _render_viewer_shell, _viewer_shell_asset_path


@dataclass(frozen=True)
class ReplayStageResult:
    session_id: str
    stage_root: Path
    state_count: int
    index_path: Path
    manifest_path: Path


@dataclass(frozen=True)
class ReplaySaveResult:
    session_id: str
    destination: Path
    state_count: int
    index_path: Path
    manifest_path: Path


@dataclass(frozen=True)
class ReplayExportResult:
    session_id: str
    destination: Path
    state_count: int
    manifest_path: str
    index_path: str


def _validate_manifest_state_id(value: Any) -> str:
    state_id = str(value).strip()
    if not state_id:
        raise ValueError("Invalid manifest state entry: state_id must be non-empty")
    state_id_path = PurePosixPath(state_id)
    parts = state_id_path.parts
    if state_id_path.is_absolute() or len(parts) != 1:
        raise ValueError("Invalid manifest state entry: state_id must be a single segment")
    segment = parts[0]
    if segment in {"", ".", ".."} or "\\" in segment:
        raise ValueError("Invalid manifest state entry: state_id contains invalid segment")
    return segment


def _validate_manifest_entry(value: Any) -> PurePosixPath:
    entry = str(value).strip()
    if not entry:
        raise ValueError("Invalid manifest state entry: entry must be non-empty")
    entry_path = PurePosixPath(entry)
    if entry_path.is_absolute():
        raise ValueError("Invalid manifest state entry: entry must be relative")
    parts = entry_path.parts
    if not parts:
        raise ValueError("Invalid manifest state entry: entry must be non-empty")
    if any(part in {"", ".", ".."} or "\\" in part for part in parts):
        raise ValueError("Invalid manifest state entry: entry contains invalid segments")
    return entry_path


def _resolve_under_root(path: Path, root: Path, *, field: str) -> Path:
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(
            f"Invalid manifest state entry: {field} escapes allowed root"
        ) from exc
    return resolved_path


def _validate_force_destination(destination_path: Path) -> None:
    resolved_destination = destination_path.resolve()
    if resolved_destination == resolved_destination.parent:
        raise ValueError(
            f"Refusing to overwrite filesystem root with --force: {resolved_destination}"
        )


def _validate_archive_entry_name(name: str) -> str:
    candidate = name.strip()
    if not candidate:
        raise ValueError("Invalid archive entry name: empty")
    if candidate.startswith("/") or candidate.startswith("\\"):
        raise ValueError(f"Invalid archive entry name: absolute path not allowed: {name}")
    entry_path = PurePosixPath(candidate)
    if entry_path.is_absolute():
        raise ValueError(f"Invalid archive entry name: absolute path not allowed: {name}")
    if any(part in {"", ".", ".."} for part in entry_path.parts):
        raise ValueError(f"Invalid archive entry name: traversal segments not allowed: {name}")
    if any("\\" in part for part in entry_path.parts):
        raise ValueError(f"Invalid archive entry name: backslash not allowed: {name}")
    return entry_path.as_posix()


def stage_replay_artifact(
    *,
    registry: SessionRegistry,
    session_id: str,
    stage_root: str | Path,
) -> ReplayStageResult:
    """Write a static replayable artifact into an empty staging directory."""
    root = Path(stage_root)
    if root.exists() and any(root.iterdir()):
        raise ValueError(f"Staging directory must be empty: {root}")
    root.mkdir(parents=True, exist_ok=True)

    manifest = registry.load_manifest(session_id)
    normalized_session_id = str(manifest["session_id"])
    session_root = registry.session_root(normalized_session_id)
    session_metadata = read_json(session_root / "session.json")

    manifest_states = manifest.get("states")
    if not isinstance(manifest_states, list):
        raise ValueError("Invalid manifest states payload")

    static_states: list[dict[str, Any]] = []
    states_root = root / "states"
    source_states_root = session_root / "states"
    for manifest_state in manifest_states:
        if not isinstance(manifest_state, dict):
            raise ValueError("Invalid manifest state entry")
        state_id = _validate_manifest_state_id(manifest_state.get("state_id", ""))
        entry_path = _validate_manifest_entry(manifest_state.get("entry", ""))

        source_content_root = _resolve_under_root(
            registry.state_root(normalized_session_id, state_id) / "content",
            source_states_root,
            field="state_id",
        )
        if not source_content_root.exists():
            raise ValueError(f"Missing content for state {state_id}")

        destination_content_root = states_root / state_id / "content"
        _resolve_under_root(destination_content_root, states_root, field="state_id")
        _resolve_under_root(
            destination_content_root.joinpath(*entry_path.parts),
            destination_content_root,
            field="entry",
        )
        shutil.copytree(source_content_root, destination_content_root)

        static_state = dict(manifest_state)
        static_state["state_id"] = state_id
        static_state["entry"] = entry_path.as_posix()
        static_state["url"] = (
            PurePosixPath("states") / state_id / "content" / entry_path
        ).as_posix()
        static_states.append(static_state)

    shell_html = _render_viewer_shell(
        normalized_session_id,
        shell_css_url="shell.css",
        shell_js_url="shell.js",
        manifest_url="liveview.session.json",
        events_url="",
    )
    index_path = root / "index.html"
    atomic_write_text(index_path, shell_html)
    shutil.copy2(_viewer_shell_asset_path("viewer_shell.css"), root / "shell.css")
    shutil.copy2(_viewer_shell_asset_path("viewer_shell.js"), root / "shell.js")

    replay_manifest = dict(manifest)
    replay_manifest["artifact_kind"] = "liveview.session"
    replay_manifest["title"] = session_metadata.get("title")
    replay_manifest["session"] = session_metadata
    replay_manifest["states"] = static_states
    replay_manifest["state_count"] = len(static_states)
    replay_manifest["latest_state_id"] = (
        static_states[-1]["state_id"] if static_states else None
    )

    manifest_path = root / "liveview.session.json"
    atomic_write_json(manifest_path, replay_manifest)

    return ReplayStageResult(
        session_id=normalized_session_id,
        stage_root=root,
        state_count=len(static_states),
        index_path=index_path,
        manifest_path=manifest_path,
    )


def save_replay_artifact(
    *,
    registry: SessionRegistry,
    session_id: str,
    destination: str | Path,
    force: bool = False,
) -> ReplaySaveResult:
    """Save a static replay artifact into DEST."""
    destination_path = Path(destination).expanduser()
    destination_exists_at_preflight = destination_path.exists()
    if force:
        _validate_force_destination(destination_path)
    if destination_path.exists() and not destination_path.is_dir():
        raise ValueError(f"Destination exists and is not a directory: {destination_path}")
    if destination_path.exists() and any(destination_path.iterdir()) and not force:
        raise ValueError(
            f"Destination is non-empty, pass --force to overwrite: {destination_path}"
        )
    if destination_path.exists() and not force:
        raise ValueError(
            f"Destination exists, pass --force to overwrite: {destination_path}"
        )

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    stage_root = Path(
        tempfile.mkdtemp(
            prefix=".liveview-save-stage-",
            dir=str(destination_path.parent),
        )
    )
    staged = stage_replay_artifact(
        registry=registry,
        session_id=session_id,
        stage_root=stage_root,
    )

    committed = False
    try:
        if force and destination_path.exists():
            if not destination_path.is_dir():
                raise ValueError(
                    f"Destination exists and is not a directory: {destination_path}"
                )
            shutil.rmtree(destination_path)
        try:
            stage_root.rename(destination_path)
        except OSError as exc:
            if not force and destination_path.exists() and not destination_exists_at_preflight:
                raise ValueError(
                    f"Destination appeared during commit, pass --force to overwrite: {destination_path}"
                ) from exc
            raise
        committed = True
    finally:
        if not committed and stage_root.exists():
            shutil.rmtree(stage_root, ignore_errors=True)

    final_destination = destination_path.resolve()
    return ReplaySaveResult(
        session_id=staged.session_id,
        destination=final_destination,
        state_count=staged.state_count,
        index_path=final_destination / "index.html",
        manifest_path=final_destination / "liveview.session.json",
    )


def export_replay_archive(
    *,
    registry: SessionRegistry,
    session_id: str,
    destination: str | Path,
    force: bool = False,
) -> ReplayExportResult:
    """Export a replay artifact as a deterministic .zip archive."""
    destination_path = Path(destination).expanduser()
    destination_exists_at_preflight = destination_path.exists()
    if force:
        _validate_force_destination(destination_path)
    if destination_path.exists() and destination_path.is_dir():
        raise ValueError(f"Destination exists and is a directory: {destination_path}")
    if destination_path.exists() and not force:
        raise ValueError(
            f"Destination exists, pass --force to overwrite: {destination_path}"
        )

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    stage_root = Path(
        tempfile.mkdtemp(
            prefix=".liveview-export-stage-",
            dir=str(destination_path.parent),
        )
    )
    staged = stage_replay_artifact(
        registry=registry,
        session_id=session_id,
        stage_root=stage_root,
    )
    archive_temp_fd, archive_temp_name = tempfile.mkstemp(
        prefix=f".{destination_path.name}.",
        suffix=".tmp",
        dir=str(destination_path.parent),
    )
    os.close(archive_temp_fd)
    Path(archive_temp_name).unlink(missing_ok=True)
    archive_temp_path = Path(archive_temp_name)

    committed = False
    try:
        entries: list[tuple[str, Path]] = []
        for file_path in staged.stage_root.rglob("*"):
            if not file_path.is_file():
                continue
            relative = file_path.relative_to(staged.stage_root)
            entry_name = _validate_archive_entry_name(
                PurePosixPath(*relative.parts).as_posix()
            )
            entries.append((entry_name, file_path))
        entries.sort(key=lambda pair: pair[0])

        with zipfile.ZipFile(
            archive_temp_path,
            mode="w",
            compression=zipfile.ZIP_STORED,
            allowZip64=True,
        ) as archive:
            for entry_name, file_path in entries:
                info = zipfile.ZipInfo(filename=entry_name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, file_path.read_bytes())

        if force:
            if destination_path.exists():
                if destination_path.is_dir():
                    raise ValueError(
                        f"Destination exists and is a directory: {destination_path}"
                    )
                destination_path.unlink()
            archive_temp_path.replace(destination_path)
        else:
            try:
                fd = os.open(
                    destination_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o644,
                )
            except FileExistsError as exc:
                if not destination_exists_at_preflight:
                    raise ValueError(
                        f"Destination appeared during commit, pass --force to overwrite: {destination_path}"
                    ) from exc
                raise ValueError(
                    f"Destination exists, pass --force to overwrite: {destination_path}"
                ) from exc
            try:
                with (
                    os.fdopen(fd, "wb") as dst_handle,
                    archive_temp_path.open("rb") as src_handle,
                ):
                    shutil.copyfileobj(src_handle, dst_handle)
            except Exception:
                destination_path.unlink(missing_ok=True)
                raise
        committed = True
    finally:
        if not committed and archive_temp_path.exists():
            archive_temp_path.unlink(missing_ok=True)
        shutil.rmtree(stage_root, ignore_errors=True)

    final_destination = destination_path.resolve()
    return ReplayExportResult(
        session_id=staged.session_id,
        destination=final_destination,
        state_count=staged.state_count,
        manifest_path="liveview.session.json",
        index_path="index.html",
    )
