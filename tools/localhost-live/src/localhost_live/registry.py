"""Session registry and state sequencing independent of HTTP transport."""

from __future__ import annotations

import re
import secrets
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from localhost_live.importer import ImportLimits, ImportResult, import_state_source
from localhost_live.jsonio import atomic_write_json, read_json
from localhost_live.metadata import SCHEMA_VERSION, build_session_metadata
from localhost_live.runtime import resolve_runtime_root


_SESSION_ID_PATTERN = re.compile(r"[0-9a-f]{32}")


@dataclass(frozen=True)
class SessionCreateResult:
    session_id: str
    session_root: Path
    session_path: Path
    manifest_path: Path
    state_count: int


@dataclass(frozen=True)
class PushStateResult:
    session_id: str
    state_id: str
    state_root: Path
    manifest_path: Path
    replaced_latest: bool
    state_url: str
    source_kind: str


class SessionNotFoundError(FileNotFoundError):
    """Raised when a requested session ID does not exist."""


class InvalidSessionIdError(ValueError):
    """Raised when externally supplied session IDs violate service format."""


class SessionRegistry:
    """Filesystem-backed registry for sessions and ordered immutable states."""

    def __init__(self, runtime_root: str | Path | None = None) -> None:
        self.runtime_root = resolve_runtime_root(runtime_root)

    @staticmethod
    def generate_session_id() -> str:
        """Generate an opaque session ID."""
        return secrets.token_hex(16)

    def create_session(
        self,
        *,
        title: str | None = None,
        source: str | Path | None = None,
        entry: str = "index.html",
        limits: ImportLimits | None = None,
    ) -> SessionCreateResult:
        """Create a session and optional initial state snapshot."""
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        sessions_root = self.runtime_root / "sessions"
        sessions_root.mkdir(parents=True, exist_ok=True)

        session_id = self._allocate_session_id()
        session_root = self.session_root(session_id)
        session_root.mkdir(parents=True, exist_ok=False)
        (session_root / "states").mkdir(parents=True, exist_ok=False)

        created_at = _utc_now()
        session_payload = build_session_metadata(
            session_id=session_id,
            created_at=created_at,
            title=title,
        )
        session_path = session_root / "session.json"
        atomic_write_json(session_path, session_payload)

        manifest_path = session_root / "manifest.json"
        manifest = _build_manifest(
            session_id=session_id,
            created_at=created_at,
            updated_at=created_at,
            states=[],
        )
        atomic_write_json(manifest_path, manifest)

        result = SessionCreateResult(
            session_id=session_id,
            session_root=session_root,
            session_path=session_path,
            manifest_path=manifest_path,
            state_count=0,
        )

        if source is not None:
            try:
                push_result = self.push_state(
                    session_id,
                    source=source,
                    entry=entry,
                    replace_latest=False,
                    limits=limits,
                )
            except Exception:
                shutil.rmtree(session_root, ignore_errors=True)
                raise
            return SessionCreateResult(
                session_id=session_id,
                session_root=session_root,
                session_path=session_path,
                manifest_path=manifest_path,
                state_count=1 if push_result else 0,
            )

        return result

    def push_state(
        self,
        session_id: str,
        *,
        source: str | Path,
        entry: str = "index.html",
        replace_latest: bool = False,
        limits: ImportLimits | None = None,
    ) -> PushStateResult:
        """Append or replace latest state in a session manifest."""
        normalized_session_id = self._validate_session_id(session_id)
        session_root = self.session_root(session_id)
        manifest_path = session_root / "manifest.json"
        if not manifest_path.exists():
            raise SessionNotFoundError(f"Unknown session: {normalized_session_id}")

        manifest = read_json(manifest_path)
        states = list(manifest.get("states", []))

        if replace_latest:
            if not states:
                raise ValueError("Cannot replace latest state on empty session")
            latest = states[-1]
            sequence = int(latest["sequence"])
            state_id = str(latest["state_id"])
            state_root = self.state_root(normalized_session_id, state_id)
            state_root_for_import = self._replace_temp_root(normalized_session_id, state_id)
        else:
            sequence = len(states) + 1
            state_id = f"{sequence:06d}"
            state_root = self.state_root(normalized_session_id, state_id)
            state_root_for_import = state_root

        state_root_for_import.mkdir(parents=True, exist_ok=True)
        try:
            imported = import_state_source(
                source=source,
                state_root=state_root_for_import,
                entry=entry,
                limits=limits,
            )
            state_payload = read_json(state_root_for_import / "state.json")
        except Exception:
            if replace_latest:
                shutil.rmtree(state_root_for_import, ignore_errors=True)
            raise
        manifest_state = _build_manifest_state_entry(
            session_id=normalized_session_id,
            state_id=state_id,
            sequence=sequence,
            state_payload=state_payload,
            import_result=imported,
        )

        if replace_latest:
            states[-1] = manifest_state
        else:
            states.append(manifest_state)

        updated_at = imported.imported_at
        next_manifest = _build_manifest(
            session_id=normalized_session_id,
            created_at=manifest.get("created_at", updated_at),
            updated_at=updated_at,
            states=states,
        )

        if replace_latest:
            self._commit_latest_replacement(
                state_id=state_id,
                target_state_root=state_root,
                replacement_state_root=state_root_for_import,
                manifest_path=manifest_path,
                next_manifest=next_manifest,
            )
        else:
            atomic_write_json(manifest_path, next_manifest)

        return PushStateResult(
            session_id=normalized_session_id,
            state_id=state_id,
            state_root=state_root,
            manifest_path=manifest_path,
            replaced_latest=replace_latest,
            state_url=manifest_state["url"],
            source_kind=imported.source_kind,
        )

    def load_manifest(self, session_id: str) -> dict[str, Any]:
        """Load manifest metadata for a session."""
        normalized_session_id = self._validate_session_id(session_id)
        manifest_path = self.session_root(session_id) / "manifest.json"
        if not manifest_path.exists():
            raise SessionNotFoundError(f"Unknown session: {normalized_session_id}")
        return read_json(manifest_path)

    def session_root(self, session_id: str) -> Path:
        return self.runtime_root / "sessions" / self._validate_session_id(session_id)

    def state_root(self, session_id: str, state_id: str) -> Path:
        return self.session_root(session_id) / "states" / state_id

    def _allocate_session_id(self) -> str:
        for _ in range(32):
            session_id = self.generate_session_id()
            if not self.session_root(session_id).exists():
                return session_id
        raise RuntimeError("Unable to allocate unique session ID")

    def _validate_session_id(self, session_id: str) -> str:
        candidate = session_id.strip()
        if not _SESSION_ID_PATTERN.fullmatch(candidate):
            raise InvalidSessionIdError(
                f"Invalid session ID format: {session_id!r}. Expected 32 lowercase hex chars."
            )
        return candidate

    def _replace_temp_root(self, session_id: str, state_id: str) -> Path:
        return self.session_root(session_id) / "states" / (
            f".replace-{state_id}-{secrets.token_hex(8)}"
        )

    def _commit_latest_replacement(
        self,
        *,
        state_id: str,
        target_state_root: Path,
        replacement_state_root: Path,
        manifest_path: Path,
        next_manifest: dict[str, Any],
    ) -> None:
        backup_state_root = target_state_root.parent / (
            f".backup-{state_id}-{secrets.token_hex(8)}"
        )
        swapped = False
        try:
            if target_state_root.exists():
                target_state_root.rename(backup_state_root)
            replacement_state_root.rename(target_state_root)
            swapped = True
            atomic_write_json(manifest_path, next_manifest)
        except Exception:
            if swapped:
                shutil.rmtree(target_state_root, ignore_errors=True)
                if backup_state_root.exists():
                    backup_state_root.rename(target_state_root)
            else:
                if backup_state_root.exists() and not target_state_root.exists():
                    backup_state_root.rename(target_state_root)
                shutil.rmtree(replacement_state_root, ignore_errors=True)
            raise
        finally:
            if backup_state_root.exists():
                shutil.rmtree(backup_state_root, ignore_errors=True)
            if replacement_state_root.exists():
                shutil.rmtree(replacement_state_root, ignore_errors=True)


def _build_manifest(
    *,
    session_id: str,
    created_at: str,
    updated_at: str,
    states: list[dict[str, Any]],
) -> dict[str, Any]:
    latest_state_id = states[-1]["state_id"] if states else None
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "manifest",
        "session_id": session_id,
        "created_at": created_at,
        "updated_at": updated_at,
        "state_count": len(states),
        "latest_state_id": latest_state_id,
        "states": states,
    }


def _build_manifest_state_entry(
    *,
    session_id: str,
    state_id: str,
    sequence: int,
    state_payload: dict[str, Any],
    import_result: ImportResult,
) -> dict[str, Any]:
    return {
        "state_id": state_id,
        "sequence": sequence,
        "entry": state_payload["entry"],
        "created_at": state_payload["created_at"],
        "url": f"/s/{session_id}/states/{state_id}/",
        "source": state_payload.get("source"),
        "source_kind": import_result.source_kind,
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
