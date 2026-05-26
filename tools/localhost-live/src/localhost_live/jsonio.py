"""JSON and text IO helpers with atomic write semantics."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def read_json(path: str | Path) -> dict[str, Any]:
    """Read and parse a JSON object from disk."""
    target = Path(path)
    with target.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object at {target}, got {type(payload)!r}")
    return payload


def atomic_write_text(path: str | Path, content: str) -> None:
    """Atomically write text to a target path using same-directory rename."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(
        prefix=f"{target.name}.",
        suffix=".tmp",
        dir=str(target.parent),
        text=True,
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(tmp_path), str(target))
        try:
            dir_fd = os.open(str(target.parent), os.O_RDONLY)
        except OSError:
            dir_fd = None
        if dir_fd is not None:
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def atomic_write_json(path: str | Path, payload: dict[str, Any]) -> None:
    """Atomically serialize and write a JSON object to disk."""
    serialized = json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2)
    atomic_write_text(path, f"{serialized}\n")
