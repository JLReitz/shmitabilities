import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shmitty_core.frontmatter import (
    load_frontmatter,
)
from shmitty_core.frontmatter import (
    split_frontmatter as split_shared_frontmatter,
)

from .errors import KnowledgeError

INDEX_SEPARATOR_PATTERN = re.compile(r"(?:^|\n)[ \t]*\n---[ \t]*\n[ \t]*\n")


@dataclass(frozen=True)
class Document:
    path: Path
    metadata: dict[str, Any]
    body: str
    contents: str = ""
    has_index_separator: bool = False

    @property
    def concept_body(self) -> str:
        """Include both authored sections of a topic Concept."""
        if self.path.name == "index.md" and self.metadata.get("type") == "Concept":
            return self.body + "\n" + self.contents
        return self.body


def split_frontmatter(text: str, path: Path) -> tuple[dict[str, Any], str]:
    parsed = split_shared_frontmatter(text, path, KnowledgeError)
    return parsed.metadata, parsed.body


def load_document(path: Path) -> Document:
    parsed = load_frontmatter(path, KnowledgeError)
    metadata = parsed.metadata
    body = parsed.body
    contents = ""
    has_index_separator = False
    if path.name == "index.md" and metadata.get("type") in {"Concept", "Reference"}:
        separator = INDEX_SEPARATOR_PATTERN.search(body)
        if separator:
            contents = body[separator.end() :]
            body = body[: separator.start()]
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
    if path.name == "index.md" and (not lines or lines[0].strip() != "---"):
        return Document(path=path, metadata={}, body="", contents=text)
    return load_document(path)
