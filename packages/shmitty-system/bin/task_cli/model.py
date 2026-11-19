"""Task graph values."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from shmitty_core.errors import ShmittyError


@dataclass(frozen=True)
class TaskItem:
    """One validated task item and its authored Markdown sections."""

    identity: str
    path: Path
    title: str
    item_type: str
    status: str
    tags: tuple[str, ...]
    dependencies: tuple[str, ...]
    description: str
    context: str
    source: str

    @property
    def directory(self) -> PurePosixPath:
        """Return the item directory relative to the task root."""
        return PurePosixPath(self.identity).parent


@dataclass(frozen=True)
class TaskGraph:
    """A complete validated task graph and its derived relationships."""

    root: Path
    items: dict[str, TaskItem]
    parents: dict[str, str | None]
    children: dict[str, tuple[str, ...]]
    dependents: dict[str, tuple[str, ...]]


@dataclass(frozen=True)
class Diagnostic:
    """One deterministic user-facing graph diagnostic."""

    path: str
    field: str
    detail: str

    def render(self, operation: str) -> str:
        """Render the task-cli diagnostic contract."""
        return f"task-cli {operation}: {self.path}: {self.field}: {self.detail}"


class TaskGraphError(ShmittyError):
    """One or more task graph diagnostics that prevent normal output."""

    def __init__(self, diagnostics: tuple[Diagnostic, ...]) -> None:
        super().__init__("invalid task graph")
        self.diagnostics = diagnostics
