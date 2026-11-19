"""Resolve workspaces from the Shmitty workspace registry."""

from __future__ import annotations

import os
from pathlib import Path


def _contains(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def find_workspace(cwd: Path, home: Path) -> Path | None:
    """Return the deepest registered workspace that contains ``cwd``."""
    normalized_cwd = Path(os.path.abspath(cwd))
    registry = Path(os.path.abspath(home)) / ".agents" / "workspaces"
    try:
        entries = tuple(registry.iterdir())
    except FileNotFoundError:
        return None

    matches = set()
    for entry in entries:
        if not entry.is_symlink():
            continue
        target = Path(os.path.abspath(registry / os.readlink(entry)))
        if _contains(target, normalized_cwd):
            matches.add(target)
    if not matches:
        return None
    return max(matches, key=lambda path: len(path.parts))
