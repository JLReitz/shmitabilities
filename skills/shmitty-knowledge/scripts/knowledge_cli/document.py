import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Tuple

import yaml

from .errors import KnowledgeError


INDEX_SEPARATOR_PATTERN = re.compile(
    r"(?:^|\n)[ \t]*\n---[ \t]*\n[ \t]*\n"
)


@dataclass(frozen=True)
class Document:
    path: Path
    metadata: Dict[str, Any]
    body: str
    contents: str = ""
    has_index_separator: bool = False

    @property
    def concept_body(self) -> str:
        """Include both authored sections of a topic Concept."""
        if (self.path.name == "index.md"
                and self.metadata.get("type") == "Concept"):
            return self.body + "\n" + self.contents
        return self.body


def split_frontmatter(text: str, path: Path) -> Tuple[Dict[str, Any], str]:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise KnowledgeError(f"{path}: missing YAML frontmatter")
    closing = next(
        (i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"),
        None,
    )
    if closing is None:
        raise KnowledgeError(f"{path}: unclosed YAML frontmatter")
    try:
        data = yaml.safe_load("".join(lines[1:closing])) or {}
    except yaml.YAMLError as exc:
        raise KnowledgeError(
            f"{path}: invalid YAML frontmatter: {exc}"
        ) from exc
    if not isinstance(data, dict):
        raise KnowledgeError(f"{path}: frontmatter must be a mapping")
    return data, "".join(lines[closing + 1 :])


def load_document(path: Path) -> Document:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise KnowledgeError(f"{path}: cannot read document: {exc}") from exc
    metadata, body = split_frontmatter(text, path)
    contents = ""
    has_index_separator = False
    if (
        path.name == "index.md"
        and metadata.get("type") in {"Concept", "Reference"}
    ):
        separator = INDEX_SEPARATOR_PATTERN.search(body)
        if separator:
            contents = body[separator.end():]
            body = body[:separator.start()]
            has_index_separator = True
    return Document(
        path=path,
        metadata=metadata,
        body=body,
        contents=contents,
        has_index_separator=has_index_separator,
    )


def load_index_for_read(path: Path) -> Document:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise KnowledgeError(f"{path}: cannot read document: {exc}") from exc
    lines = text.splitlines()
    if path.name == "index.md" and (
        not lines or lines[0].strip() != "---"
    ):
        return Document(path=path, metadata={}, body="", contents=text)
    return load_document(path)
