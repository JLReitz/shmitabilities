"""Filesystem importer with safe snapshot rules for state content."""

from __future__ import annotations

import os
import stat
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from localhost_live.jsonio import atomic_write_json
from localhost_live.metadata import build_source_metadata, build_state_metadata


_DEFAULT_ENTRY = "index.html"
_SECRET_MARKERS = (
    "secret",
    "token",
    "password",
    "passwd",
    "credential",
    "private",
    "apikey",
    "api_key",
)


@dataclass(frozen=True)
class ImportLimits:
    max_total_bytes: int = 32 * 1024 * 1024
    max_file_bytes: int = 8 * 1024 * 1024
    max_files: int = 4096


@dataclass(frozen=True)
class ImportResult:
    source_kind: str
    source_path: Path
    state_root: Path
    entry: str
    imported_at: str
    bytes_copied: int
    files_copied: int


@dataclass(frozen=True)
class PlannedFile:
    source_path: Path
    relative_path: Path
    size: int
    expected_device: int
    expected_inode: int
    expected_mode: int


class ImportRejectedError(ValueError):
    """Raised when source content violates importer safety rules."""

    def __init__(self, diagnostics: list[str]) -> None:
        super().__init__("Source import rejected")
        self.diagnostics = diagnostics


def import_state_source(
    source: str | Path,
    state_root: str | Path,
    *,
    entry: str = _DEFAULT_ENTRY,
    limits: ImportLimits | None = None,
    imported_at: str | None = None,
) -> ImportResult:
    """Import FILE or DIR source into a state content snapshot."""
    selected_limits = limits or ImportLimits()
    state_root_path = Path(state_root)
    entry_normalized, entry_diagnostics = _normalize_entry(entry)
    when = imported_at or _utc_now()

    source_input = Path(source)
    diagnostics: list[str] = list(entry_diagnostics)

    try:
        source_resolved = source_input.resolve(strict=True)
    except FileNotFoundError:
        source_resolved = source_input.resolve(strict=False)
        diagnostics.append("missing-source")
        _persist_rejection(
            state_root_path=state_root_path,
            source_kind="unknown",
            source_path=source_resolved,
            entry=entry_normalized,
            imported_at=when,
            diagnostics=diagnostics,
        )
        raise ImportRejectedError(diagnostics)

    if source_resolved.is_file():
        source_kind = "file"
    elif source_resolved.is_dir():
        source_kind = "dir"
    else:
        source_kind = "unknown"
        diagnostics.append("unsupported-source-kind")
        _persist_rejection(
            state_root_path=state_root_path,
            source_kind=source_kind,
            source_path=source_resolved,
            entry=entry_normalized,
            imported_at=when,
            diagnostics=diagnostics,
        )
        raise ImportRejectedError(diagnostics)

    if source_input.is_symlink():
        diagnostics.append("symlink-source")

    if source_kind == "file":
        diagnostics.extend(_validate_source_path_segments(source_resolved))
        stat_result = os.lstat(source_resolved)
        if not stat.S_ISREG(stat_result.st_mode):
            diagnostics.append(f"not-regular-file:{source_resolved}")
        file_size = stat_result.st_size
        if file_size > selected_limits.max_file_bytes:
            diagnostics.append(f"oversize-file:{source_resolved.name}:{file_size}")
        if file_size > selected_limits.max_total_bytes:
            diagnostics.append(
                f"oversize-total:{source_resolved.name}:{file_size}>{selected_limits.max_total_bytes}"
            )
        plan = [
            PlannedFile(
                source_path=source_resolved,
                relative_path=Path(entry_normalized),
                size=file_size,
                expected_device=stat_result.st_dev,
                expected_inode=stat_result.st_ino,
                expected_mode=stat_result.st_mode,
            )
        ]
    else:
        plan, dir_diagnostics = _plan_directory_copy(
            source_resolved,
            entry_normalized,
            selected_limits,
        )
        diagnostics.extend(dir_diagnostics)

    if diagnostics:
        diagnostics = sorted(dict.fromkeys(diagnostics))
        _persist_rejection(
            state_root_path=state_root_path,
            source_kind=source_kind,
            source_path=source_resolved,
            entry=entry_normalized,
            imported_at=when,
            diagnostics=diagnostics,
        )
        raise ImportRejectedError(diagnostics)

    files_copied = len(plan)
    bytes_copied = sum(item.size for item in plan)

    content_root = state_root_path / "content"
    if content_root.exists():
        diagnostics = ["content-already-exists"]
        _persist_rejection(
            state_root_path=state_root_path,
            source_kind=source_kind,
            source_path=source_resolved,
            entry=entry_normalized,
            imported_at=when,
            diagnostics=diagnostics,
        )
        raise ImportRejectedError(diagnostics)

    try:
        for plan_item in plan:
            destination_path = content_root / plan_item.relative_path
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            _copy_planned_file(plan_item, destination_path)
    except ImportRejectedError as exc:
        shutil.rmtree(content_root, ignore_errors=True)
        diagnostics = sorted(dict.fromkeys(exc.diagnostics))
        _persist_rejection(
            state_root_path=state_root_path,
            source_kind=source_kind,
            source_path=source_resolved,
            entry=entry_normalized,
            imported_at=when,
            diagnostics=diagnostics,
        )
        raise ImportRejectedError(diagnostics) from exc
    except Exception:
        shutil.rmtree(content_root, ignore_errors=True)
        raise

    source_metadata = build_source_metadata(
        source_kind=source_kind,
        original_path=str(source_resolved),
        entry=entry_normalized,
        imported_at=when,
    )
    atomic_write_json(state_root_path / "source.json", source_metadata)

    state_metadata = build_state_metadata(
        state_id=state_root_path.name,
        entry=entry_normalized,
        created_at=when,
        source=source_metadata,
    )
    atomic_write_json(state_root_path / "state.json", state_metadata)

    return ImportResult(
        source_kind=source_kind,
        source_path=source_resolved,
        state_root=state_root_path,
        entry=entry_normalized,
        imported_at=when,
        bytes_copied=bytes_copied,
        files_copied=files_copied,
    )


def _plan_directory_copy(
    source_root: Path,
    entry: str,
    limits: ImportLimits,
) -> tuple[list[PlannedFile], list[str]]:
    diagnostics: list[str] = []
    files: list[PlannedFile] = []
    total_bytes = 0

    for walk_root, dir_names, file_names in os.walk(
        source_root, topdown=True, followlinks=False
    ):
        dir_names.sort()
        file_names.sort()

        current_dir = Path(walk_root)
        next_dirs: list[str] = []
        for dir_name in dir_names:
            dir_path = current_dir / dir_name
            rel_dir = dir_path.relative_to(source_root)
            diagnostics.extend(_validate_rel_path(rel_dir))
            if dir_path.is_symlink():
                diagnostics.extend(_symlink_diagnostics(dir_path, source_root, rel_dir))
                continue
            next_dirs.append(dir_name)
        dir_names[:] = next_dirs

        for file_name in file_names:
            file_path = current_dir / file_name
            rel_file = file_path.relative_to(source_root)
            diagnostics.extend(_validate_rel_path(rel_file))

            if file_path.is_symlink():
                diagnostics.extend(_symlink_diagnostics(file_path, source_root, rel_file))
                continue

            stat_result = os.lstat(file_path)
            if not stat.S_ISREG(stat_result.st_mode):
                diagnostics.append(f"not-regular-file:{rel_file}")
                continue

            file_size = stat_result.st_size
            if file_size > limits.max_file_bytes:
                diagnostics.append(f"oversize-file:{rel_file}:{file_size}")

            total_bytes += file_size
            if total_bytes > limits.max_total_bytes:
                diagnostics.append(
                    f"oversize-total:{total_bytes}>{limits.max_total_bytes}"
                )

            files.append(
                PlannedFile(
                    source_path=file_path,
                    relative_path=rel_file,
                    size=file_size,
                    expected_device=stat_result.st_dev,
                    expected_inode=stat_result.st_ino,
                    expected_mode=stat_result.st_mode,
                )
            )
            if len(files) > limits.max_files:
                diagnostics.append(f"too-many-files:{len(files)}>{limits.max_files}")

    entry_path = source_root / entry
    if not entry_path.exists():
        diagnostics.append(f"missing-entry:{entry}")
    elif not entry_path.is_file():
        diagnostics.append(f"entry-not-file:{entry}")
    elif entry_path.is_symlink():
        diagnostics.extend(_symlink_diagnostics(entry_path, source_root, Path(entry)))

    return files, diagnostics


def _validate_source_path_segments(path: Path) -> list[str]:
    parts = [part for part in path.parts if part not in ("", path.anchor)]
    diagnostics: list[str] = []
    for index in range(len(parts)):
        rel = Path(*parts[: index + 1])
        diagnostics.extend(_validate_rel_path(rel))
    return diagnostics


def _validate_rel_path(relative_path: Path) -> list[str]:
    diagnostics: list[str] = []
    for part in relative_path.parts:
        lowered = part.lower()
        if part in ("", ".", ".."):
            diagnostics.append(f"traversal:{relative_path}")
        if part.startswith("."):
            diagnostics.append(f"dotfile:{relative_path}")
        if lowered == ".env":
            diagnostics.append(f".env:{relative_path}")
        if lowered == ".git" or lowered.startswith(".git"):
            diagnostics.append(f".git:{relative_path}")
        if _is_secret_like_name(lowered):
            diagnostics.append(f"secret-like:{relative_path}")
    return diagnostics


def _normalize_entry(entry: str) -> tuple[str, list[str]]:
    raw = entry.strip() or _DEFAULT_ENTRY
    normalized_path = Path(raw)
    diagnostics: list[str] = []

    if normalized_path.is_absolute():
        diagnostics.append(f"entry-absolute:{raw}")

    for part in normalized_path.parts:
        if part in ("", ".", ".."):
            diagnostics.append(f"entry-traversal:{raw}")
        lowered = part.lower()
        if part.startswith("."):
            diagnostics.append(f"entry-dotfile:{raw}")
        if lowered == ".env":
            diagnostics.append(f"entry-.env:{raw}")
        if lowered == ".git" or lowered.startswith(".git"):
            diagnostics.append(f"entry-.git:{raw}")
        if _is_secret_like_name(lowered):
            diagnostics.append(f"entry-secret-like:{raw}")

    normalized = Path(*normalized_path.parts).as_posix()
    return normalized, diagnostics


def _symlink_diagnostics(
    path: Path,
    source_root: Path,
    relative_path: Path,
) -> list[str]:
    diagnostics: list[str] = []
    resolved = path.resolve(strict=False)
    try:
        resolved.relative_to(source_root)
    except ValueError:
        diagnostics.append(f"symlink-escape:{relative_path}->{resolved}")
    else:
        diagnostics.append(f"symlink-not-allowed:{relative_path}->{resolved}")
    return diagnostics


def _is_secret_like_name(lowered_name: str) -> bool:
    if lowered_name in {"id_rsa", "id_dsa", "authorized_keys"}:
        return True
    if lowered_name.endswith((".pem", ".p12", ".key", ".pfx")):
        return True
    return any(marker in lowered_name for marker in _SECRET_MARKERS)


def _copy_planned_file(plan_item: PlannedFile, destination_path: Path) -> None:
    current_stat = os.lstat(plan_item.source_path)
    if not _same_source_identity(plan_item, current_stat):
        raise ImportRejectedError(
            [f"source-changed:{plan_item.relative_path}:precopy-metadata-mismatch"]
        )

    open_flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        open_flags |= os.O_NOFOLLOW

    try:
        fd = os.open(plan_item.source_path, open_flags)
    except OSError as exc:
        raise ImportRejectedError(
            [f"source-changed:{plan_item.relative_path}:open-failed:{exc.__class__.__name__}"]
        ) from exc

    try:
        opened_stat = os.fstat(fd)
        if not _same_source_identity(plan_item, opened_stat):
            raise ImportRejectedError(
                [f"source-changed:{plan_item.relative_path}:opened-metadata-mismatch"]
            )
        with os.fdopen(fd, "rb", closefd=False) as source_handle:
            with destination_path.open("wb") as destination_handle:
                shutil.copyfileobj(source_handle, destination_handle)
        shutil.copystat(plan_item.source_path, destination_path, follow_symlinks=False)
    finally:
        os.close(fd)


def _same_source_identity(plan_item: PlannedFile, stat_result: os.stat_result) -> bool:
    return (
        stat.S_ISREG(stat_result.st_mode)
        and stat_result.st_dev == plan_item.expected_device
        and stat_result.st_ino == plan_item.expected_inode
        and stat_result.st_size == plan_item.size
        and stat.S_IMODE(stat_result.st_mode) == stat.S_IMODE(plan_item.expected_mode)
    )


def _persist_rejection(
    *,
    state_root_path: Path,
    source_kind: str,
    source_path: Path,
    entry: str,
    imported_at: str,
    diagnostics: list[str],
) -> None:
    source_metadata = build_source_metadata(
        source_kind=source_kind,
        original_path=str(source_path),
        entry=entry,
        imported_at=imported_at,
        rejected=diagnostics,
    )
    atomic_write_json(state_root_path / "source.json", source_metadata)


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
