"""Load and validate the complete Markdown task graph."""

from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath
from typing import Any

from shmitty_core.errors import ShmittyError
from shmitty_core.frontmatter import Frontmatter, load_frontmatter

from .model import Diagnostic, TaskGraph, TaskGraphError, TaskItem

FIELDS = ("title", "type", "status", "tags", "dependencies")
FIELD_ORDER = {field: index for index, field in enumerate(FIELDS)}
ITEM_TYPES = {"epic", "feature", "story", "task", "spike", "decision"}
STATUSES = {"created", "started", "done"}
BODY_SEPARATOR_PATTERN = re.compile(r"\n\n---[ \t]*(?:\n\n?|$)")


def _diagnostic(path: str, field: str, observed: str, expected: str, action: str) -> Diagnostic:
    return Diagnostic(
        path,
        field,
        f"observed {observed}; expected {expected}; {action}",
    )


def _read_frontmatter(path: Path, identity: str) -> tuple[Frontmatter | None, list[Diagnostic]]:
    try:
        return load_frontmatter(path), []
    except ShmittyError as exc:
        detail = str(exc)
        prefix = f"{path}: "
        detail = detail.removeprefix(prefix)
        return None, [
            _diagnostic(
                identity,
                "frontmatter",
                detail,
                "readable YAML frontmatter",
                "repair the item file",
            )
        ]


def _string_list(
    metadata: dict[str, Any],
    field: str,
    identity: str,
    diagnostics: list[Diagnostic],
) -> tuple[str, ...]:
    value = metadata.get(field)
    if (not isinstance(value, list)) or any(not isinstance(item, str) for item in value):
        diagnostics.append(
            _diagnostic(
                identity,
                field,
                repr(value),
                "a list of strings",
                f"replace {field} with a string list",
            )
        )
        return ()
    if len(value) != len(set(value)):
        diagnostics.append(
            _diagnostic(
                identity,
                field,
                "duplicate values",
                "unique values",
                f"remove duplicate {field}",
            )
        )
    return tuple(value)


def _split_body(body: str, identity: str, diagnostics: list[Diagnostic]) -> tuple[str, str]:
    separator = BODY_SEPARATOR_PATTERN.search(body)
    if separator is None:
        diagnostics.append(
            _diagnostic(
                identity,
                "description",
                "a missing description/context separator",
                "a nonempty description followed by a Markdown separator",
                "add the description and context sections",
            )
        )
        return "", ""
    description = body[: separator.start()]
    context = body[separator.end() :]
    description = description.strip()
    if not description:
        diagnostics.append(
            _diagnostic(
                identity,
                "description",
                "an empty value",
                "a nonempty description",
                "write the item description",
            )
        )
    return description, context


def _parse_item(path: Path, root: Path) -> tuple[TaskItem | None, list[Diagnostic]]:
    identity = path.relative_to(root).as_posix()
    parsed, diagnostics = _read_frontmatter(path, identity)
    if parsed is None:
        return None, diagnostics

    metadata = parsed.metadata
    unknown = sorted((key for key in metadata if key not in FIELDS), key=str)
    for field in unknown:
        field_name = str(field)
        diagnostics.append(
            _diagnostic(
                identity,
                field_name,
                "an unknown frontmatter field",
                "only title, type, status, tags, and dependencies",
                f"remove {field_name}",
            )
        )
    for field in parsed.duplicate_keys:
        diagnostics.append(
            _diagnostic(
                identity,
                field,
                "a duplicate frontmatter key",
                "one value per field",
                f"remove the duplicate {field} key",
            )
        )
    for field in FIELDS:
        if field not in metadata:
            diagnostics.append(
                _diagnostic(
                    identity,
                    field,
                    "a missing field",
                    "all five exact frontmatter fields",
                    f"add {field}",
                )
            )

    title = metadata.get("title")
    if (not isinstance(title, str)) or (not title.strip()):
        diagnostics.append(
            _diagnostic(
                identity,
                "title",
                repr(title),
                "a nonempty string",
                "write the item title",
            )
        )
        title = ""
    item_type = metadata.get("type")
    if (not isinstance(item_type, str)) or (item_type not in ITEM_TYPES):
        diagnostics.append(
            _diagnostic(
                identity,
                "type",
                repr(item_type),
                "epic, feature, story, task, spike, or decision",
                "select a supported item type",
            )
        )
        item_type = ""
    status = metadata.get("status")
    if (not isinstance(status, str)) or (status not in STATUSES):
        diagnostics.append(
            _diagnostic(
                identity,
                "status",
                repr(status),
                "created, started, or done",
                "select a supported status",
            )
        )
        status = ""
    tags = _string_list(metadata, "tags", identity, diagnostics)
    dependencies = _string_list(metadata, "dependencies", identity, diagnostics)
    description, context = _split_body(parsed.body, identity, diagnostics)

    if diagnostics:
        return None, diagnostics
    return TaskItem(
        identity=identity,
        path=path,
        title=title.strip(),
        item_type=item_type,
        status=status,
        tags=tags,
        dependencies=dependencies,
        description=description,
        context=context,
        source=path.read_text(encoding="utf-8"),
    ), []


def _scan(root: Path) -> tuple[list[Path], list[Diagnostic]]:
    paths: list[Path] = []
    diagnostics: list[Diagnostic] = []
    if (not root.is_dir()) or root.is_symlink():
        return [], [
            _diagnostic(
                str(root),
                "workspace",
                "a missing or symlinked task root",
                "a physical .agents/tasks directory",
                "create the selected tracker task root as a directory",
            )
        ]
    root_index = root / "index.md"
    if root_index.exists() or root_index.is_symlink():
        diagnostics.append(
            _diagnostic(
                str(root_index),
                "path",
                "a root task item",
                "each task item below its own directory",
                "move the item into a task directory",
            )
        )

    def scan_error(error: OSError) -> None:
        error_path = Path(error.filename) if error.filename else root
        try:
            display_path = error_path.relative_to(root).as_posix()
        except ValueError:
            display_path = str(error_path)
        diagnostics.append(
            _diagnostic(
                display_path,
                "path",
                f"an unreadable directory: {error.strerror or error}",
                "a readable task tree",
                "restore directory read access",
            )
        )

    for directory, names, files in os.walk(root, followlinks=False, onerror=scan_error):
        current = Path(directory)
        for name in sorted(names):
            candidate = current / name
            if candidate.is_symlink():
                diagnostics.append(
                    _diagnostic(
                        candidate.relative_to(root).as_posix(),
                        "path",
                        "a symlinked directory",
                        "physical task directories",
                        "replace the symlink with a directory",
                    )
                )
        for name in sorted(files):
            candidate = current / name
            if candidate.is_symlink():
                diagnostics.append(
                    _diagnostic(
                        candidate.relative_to(root).as_posix(),
                        "path",
                        "a symlinked file",
                        "physical task documents",
                        "replace the symlink with a file",
                    )
                )
            elif (name == "index.md") and (candidate != root_index):
                paths.append(candidate)
            elif (candidate.suffix == ".md") and (not (current / "index.md").is_file()):
                diagnostics.append(
                    _diagnostic(
                        candidate.relative_to(root).as_posix(),
                        "path",
                        "a supporting Markdown file outside an item directory",
                        "supporting Markdown directly in a task item directory",
                        "move the document into an item directory",
                    )
                )
    return sorted(paths), diagnostics


def _validate_dependencies(items: dict[str, TaskItem]) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    for identity in sorted(items):
        item = items[identity]
        for dependency in item.dependencies:
            parts = dependency.split("/")
            pure = PurePosixPath(dependency)
            if pure.is_absolute():
                diagnostics.append(
                    _diagnostic(
                        identity,
                        "dependencies",
                        repr(dependency),
                        "a relative item identity",
                        "use a task-root-relative path",
                    )
                )
            elif ("." in parts) or (".." in parts):
                diagnostics.append(
                    _diagnostic(
                        identity,
                        "dependencies",
                        repr(dependency),
                        "an identity without dot segments",
                        "remove dot path segments",
                    )
                )
            elif ("\\" in dependency) or (pure.name != "index.md"):
                diagnostics.append(
                    _diagnostic(
                        identity,
                        "dependencies",
                        repr(dependency),
                        "an exact POSIX item identity ending in index.md",
                        "use the blocker item identity",
                    )
                )
            elif dependency == identity:
                diagnostics.append(
                    _diagnostic(
                        identity,
                        "dependencies",
                        "a self dependency",
                        "a different blocking item",
                        "remove the self edge",
                    )
                )
            elif dependency not in items:
                diagnostics.append(
                    _diagnostic(
                        identity,
                        "dependencies",
                        repr(dependency),
                        "an existing task item",
                        "create the blocker or remove the edge",
                    )
                )
    return diagnostics


def _cycle_diagnostics(items: dict[str, TaskItem]) -> list[Diagnostic]:
    state: dict[str, int] = {}
    stack: list[str] = []
    cycles: set[tuple[str, ...]] = set()

    def visit(identity: str) -> None:
        state[identity] = 1
        stack.append(identity)
        for dependency in sorted(items[identity].dependencies):
            if dependency not in items:
                continue
            if state.get(dependency, 0) == 0:
                visit(dependency)
            elif state.get(dependency) == 1:
                start = stack.index(dependency)
                cycle = tuple(stack[start:] + [dependency])
                cycles.add(cycle)
        stack.pop()
        state[identity] = 2

    for identity in sorted(items):
        if state.get(identity, 0) == 0:
            visit(identity)
    return [
        _diagnostic(
            cycle[0],
            "dependencies",
            "a cycle: " + " -> ".join(cycle),
            "an acyclic blocking graph",
            "remove one cycle edge",
        )
        for cycle in sorted(cycles)
    ]


def _derive_relationships(
    items: dict[str, TaskItem],
) -> tuple[dict[str, str | None], dict[str, tuple[str, ...]], dict[str, tuple[str, ...]]]:
    parents: dict[str, str | None] = {}
    children: dict[str, list[str]] = {identity: [] for identity in items}
    dependents: dict[str, list[str]] = {identity: [] for identity in items}
    for identity, item in items.items():
        parent = None
        directory = item.directory.parent
        while directory != PurePosixPath("."):
            candidate = (directory / "index.md").as_posix()
            if candidate in items:
                parent = candidate
                children[candidate].append(identity)
                break
            directory = directory.parent
        parents[identity] = parent
        for dependency in item.dependencies:
            if dependency in dependents:
                dependents[dependency].append(identity)
    return (
        parents,
        {identity: tuple(sorted(values)) for identity, values in children.items()},
        {identity: tuple(sorted(values)) for identity, values in dependents.items()},
    )


def load_graph(root: Path) -> TaskGraph:
    """Load and validate every item and edge below one task root."""
    paths, diagnostics = _scan(root)
    items: dict[str, TaskItem] = {}
    for path in paths:
        item, item_diagnostics = _parse_item(path, root)
        diagnostics.extend(item_diagnostics)
        if item is not None:
            items[item.identity] = item
    diagnostics.extend(_validate_dependencies(items))
    diagnostics.extend(_cycle_diagnostics(items))
    if diagnostics:
        diagnostics.sort(
            key=lambda item: (item.path, FIELD_ORDER.get(item.field, len(FIELDS)), item.field, item.detail)
        )
        raise TaskGraphError(tuple(diagnostics))
    parents, children, dependents = _derive_relationships(items)
    return TaskGraph(root, items, parents, children, dependents)


def in_scope(identity: str, scope: str | None) -> bool:
    """Return whether an item identity is in the selected item subtree."""
    if scope is None:
        return True
    scope_directory = PurePosixPath(scope).parent
    item_directory = PurePosixPath(identity).parent
    return (item_directory == scope_directory) or (scope_directory in item_directory.parents)
