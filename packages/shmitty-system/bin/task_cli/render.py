"""Render validated task graph query results."""

from __future__ import annotations

from shmitty_core.tsv import row

from .model import TaskGraph, TaskItem


def _markdown_list(values: tuple[str, ...]) -> str:
    if not values:
        return "- (none)"
    return "\n".join(f"- `{value}`" for value in values)


def show(graph: TaskGraph, item: TaskItem) -> str:
    """Render one task and all of its direct relationships as Markdown."""
    tags = ", ".join(item.tags) if item.tags else "(none)"
    parent = f"`{graph.parents[item.identity]}`" if graph.parents[item.identity] else "(none)"
    return (
        f"# {item.title}\n\n"
        f"- Path: `{item.identity}`\n"
        f"- Type: `{item.item_type}`\n"
        f"- Status: `{item.status}`\n"
        f"- Tags: {tags}\n"
        f"- Parent: {parent}\n\n"
        "## Children\n\n"
        f"{_markdown_list(graph.children[item.identity])}\n\n"
        "## Dependencies\n\n"
        f"{_markdown_list(tuple(sorted(item.dependencies)))}\n\n"
        "## Dependents\n\n"
        f"{_markdown_list(graph.dependents[item.identity])}\n\n"
        "## Description\n\n"
        f"{item.description}\n\n"
        "## Context\n\n"
        f"{item.context}"
    )


def ready(items: tuple[TaskItem, ...]) -> str:
    """Render ready task items as TSV."""
    lines = [row(("path", "type", "title", "tags"))]
    lines.extend(row((item.identity, item.item_type, item.title, ",".join(item.tags))) for item in items)
    return "\n".join(lines) + "\n"


def search(items: tuple[tuple[TaskItem, tuple[str, ...]], ...]) -> str:
    """Render task search matches as TSV."""
    lines = [row(("path", "type", "status", "title", "tags", "matched_fields"))]
    lines.extend(
        row((item.identity, item.item_type, item.status, item.title, ",".join(item.tags), ",".join(fields)))
        for item, fields in items
    )
    return "\n".join(lines) + "\n"


def previous(items: tuple[TaskItem, ...]) -> str:
    """Render unchanged task item sources with path comments."""
    sections = []
    for item in items:
        source = item.source if item.source.endswith("\n") else item.source + "\n"
        sections.append(f"<!-- task-cli previous: {item.identity} -->\n{source}")
    return "".join(sections)
