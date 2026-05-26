"""Schema-versioned metadata helpers."""

from __future__ import annotations

from typing import Any


SCHEMA_VERSION = 1


def build_server_metadata(
    *,
    host: str,
    port: int,
    pid: int,
    idle_timeout_seconds: int,
    token_path: str,
    started_at: str,
    last_mutation_at: str | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "server",
        "host": host,
        "port": port,
        "pid": pid,
        "idle_timeout_seconds": idle_timeout_seconds,
        "token_path": token_path,
        "started_at": started_at,
        "last_mutation_at": last_mutation_at,
    }


def build_session_metadata(
    *,
    session_id: str,
    created_at: str,
    title: str | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "session",
        "session_id": session_id,
        "title": title,
        "created_at": created_at,
    }


def build_source_metadata(
    *,
    source_kind: str,
    original_path: str,
    entry: str,
    imported_at: str,
    rejected: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "source",
        "source_kind": source_kind,
        "original_path": original_path,
        "entry": entry,
        "imported_at": imported_at,
        "rejected": rejected or [],
    }


def build_state_metadata(
    *,
    state_id: str,
    entry: str,
    created_at: str,
    source: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "state",
        "state_id": state_id,
        "entry": entry,
        "created_at": created_at,
        "source": source,
    }
