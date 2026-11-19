"""Render tab-separated command output."""

from collections.abc import Iterable


def cell(value: object) -> str:
    """Return one value without TSV or Markdown control characters."""
    return str(value).replace("`", "").replace("\t", " ").replace("\r", " ").replace("\n", " ")


def row(values: Iterable[object]) -> str:
    """Return one TSV row."""
    return "\t".join(cell(value) for value in values)
