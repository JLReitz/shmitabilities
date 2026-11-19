"""Load YAML frontmatter for Shmitty Markdown documents."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .errors import ShmittyError


@dataclass(frozen=True)
class Frontmatter:
    """Parsed YAML metadata, duplicate keys, and the remaining body."""

    metadata: dict[str, Any]
    duplicate_keys: tuple[str, ...]
    body: str


class _DuplicateKeyLoader(yaml.SafeLoader):
    """Load YAML mappings while recording duplicate string keys."""

    def __init__(self, stream: str) -> None:
        super().__init__(stream)
        self.duplicate_keys: list[str] = []


def _construct_mapping(
    loader: _DuplicateKeyLoader,
    node: yaml.MappingNode,
    deep: bool = False,
) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    mapping: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        value = loader.construct_object(value_node, deep=deep)
        if (key in mapping) and isinstance(key, str):
            loader.duplicate_keys.append(key)
        mapping[key] = value
    return mapping


_DuplicateKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_mapping,
)


def split_frontmatter(
    text: str,
    path: Path,
    error_type: type[ShmittyError] = ShmittyError,
) -> Frontmatter:
    """Parse one Markdown string that starts with YAML frontmatter."""
    lines = text.splitlines(keepends=True)
    if (not lines) or (lines[0].strip() != "---"):
        raise error_type(f"{path}: missing YAML frontmatter")
    closing = next(
        (index for index, line in enumerate(lines[1:], 1) if line.strip() == "---"),
        None,
    )
    if closing is None:
        raise error_type(f"{path}: unclosed YAML frontmatter")

    loader = _DuplicateKeyLoader("".join(lines[1:closing]))
    try:
        metadata = loader.get_single_data() or {}
    except yaml.YAMLError as exc:
        raise error_type(f"{path}: invalid YAML frontmatter: {exc}") from exc
    finally:
        loader.dispose()
    if not isinstance(metadata, dict):
        raise error_type(f"{path}: frontmatter must be a mapping")

    duplicates = tuple(dict.fromkeys(loader.duplicate_keys))
    return Frontmatter(
        metadata=metadata,
        duplicate_keys=duplicates,
        body="".join(lines[closing + 1 :]),
    )


def load_frontmatter(
    path: Path,
    error_type: type[ShmittyError] = ShmittyError,
) -> Frontmatter:
    """Read and parse one frontmatter-backed Markdown document."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise error_type(f"{path}: cannot read document: {exc}") from exc
    return split_frontmatter(text, path, error_type)
