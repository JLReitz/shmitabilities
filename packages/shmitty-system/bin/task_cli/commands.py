"""Command-line entry points for task graph queries."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from shmitty_core.workspace import find_workspace

from .graph import in_scope, load_graph
from .model import Diagnostic, TaskGraph, TaskGraphError, TaskItem
from .render import previous as render_previous
from .render import ready as render_ready
from .render import search as render_search
from .render import show as render_show


def _nonempty_query(value: str) -> str:
    if not value:
        raise argparse.ArgumentTypeError("query must be nonempty")
    return value


def parser() -> argparse.ArgumentParser:
    """Build the task-cli argument parser."""
    result = argparse.ArgumentParser(prog="task-cli")
    commands = result.add_subparsers(dest="command", required=True)
    show = commands.add_parser("show")
    show.add_argument("item")
    show.add_argument("--scope")
    ready = commands.add_parser("ready")
    ready.add_argument("--scope")
    search = commands.add_parser("search")
    search.add_argument("query", type=_nonempty_query)
    previous = commands.add_parser("previous")
    previous.add_argument("--scope")
    return result


def _fail(operation: str, diagnostic: Diagnostic) -> None:
    print(diagnostic.render(operation), file=sys.stderr)


def _selected_item(graph: TaskGraph, identity: str, operation: str, field: str) -> TaskItem | None:
    item = graph.items.get(identity)
    if item is None:
        _fail(
            operation,
            Diagnostic(
                identity,
                field,
                "observed a missing task item; expected an existing item identity; select an existing item",
            ),
        )
    return item


def _validate_scope(graph: TaskGraph, scope: str | None, operation: str) -> bool:
    return (scope is None) or (_selected_item(graph, scope, operation, "scope") is not None)


def _show(graph: TaskGraph, item_identity: str, scope: str | None) -> int:
    if not _validate_scope(graph, scope, "show"):
        return 1
    item = _selected_item(graph, item_identity, "show", "item")
    if item is None:
        return 1
    if not in_scope(item_identity, scope):
        _fail(
            "show",
            Diagnostic(
                item_identity,
                "scope",
                f"observed an item outside the selected scope {scope!r}; expected an item in the scope subtree; select an in-scope item",
            ),
        )
        return 1
    print(render_show(graph, item), end="")
    return 0


def _ready(graph: TaskGraph, scope: str | None) -> int:
    if not _validate_scope(graph, scope, "ready"):
        return 1
    selected = tuple(
        item
        for identity, item in sorted(graph.items.items())
        if in_scope(identity, scope)
        and item.status == "created"
        and all(graph.items[dependency].status == "done" for dependency in item.dependencies)
    )
    print(render_ready(selected), end="")
    return 0


def _search(graph: TaskGraph, query: str) -> int:
    folded = query.casefold()
    matches = []
    for item in graph.items.values():
        fields = []
        if folded in item.title.casefold():
            fields.append("title")
        if any(folded in tag.casefold() for tag in item.tags):
            fields.append("tags")
        if fields:
            matches.append((item, tuple(fields)))
    matches.sort(key=lambda match: (match[0].title.casefold(), match[0].identity))
    print(render_search(tuple(matches)), end="")
    return 0


def _touch_time(item: TaskItem) -> int:
    times = [
        path.stat().st_mtime_ns
        for path in item.path.parent.iterdir()
        if path.is_file() and (not path.is_symlink()) and path.suffix == ".md"
    ]
    return max(times)


def _previous(graph: TaskGraph, scope: str | None) -> int:
    if not _validate_scope(graph, scope, "previous"):
        return 1
    candidates = tuple(item for identity, item in graph.items.items() if in_scope(identity, scope))
    if not candidates:
        _fail(
            "previous",
            Diagnostic(
                str(graph.root),
                "task",
                "observed an empty task graph; expected at least one task item; create a task item",
            ),
        )
        return 1
    touched = {item.identity: _touch_time(item) for item in candidates}
    latest = max(touched.values())
    selected = tuple(
        sorted((item for item in candidates if touched[item.identity] == latest), key=lambda item: item.identity)
    )
    print(render_previous(selected), end="")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run one read-only task graph command."""
    arguments = parser().parse_args(argv)
    operation = arguments.command
    home = Path(os.path.expanduser("~"))
    cwd = Path.cwd()
    workspace = find_workspace(cwd, home)
    if workspace is None:
        _fail(
            operation,
            Diagnostic(
                str(cwd),
                "workspace",
                "observed an unregistered working directory; expected a registered workspace; register the workspace",
            ),
        )
        return 1
    try:
        graph = load_graph(workspace / ".agents" / "tasks")
    except TaskGraphError as exc:
        for diagnostic in exc.diagnostics:
            _fail(operation, diagnostic)
        return 1
    if operation == "show":
        return _show(graph, arguments.item, arguments.scope)
    if operation == "ready":
        return _ready(graph, arguments.scope)
    if operation == "search":
        return _search(graph, arguments.query)
    return _previous(graph, arguments.scope)


if __name__ == "__main__":
    raise SystemExit(main())
