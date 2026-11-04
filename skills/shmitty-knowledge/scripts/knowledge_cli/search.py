from pathlib import Path
from typing import Iterable, Optional, Sequence

from .document import Document, load_document
from .errors import KnowledgeError
from .tsv import row


def matching_documents(
    root: Path,
    tags: Sequence[str],
    document_type: Optional[str],
    subtype: Optional[str],
) -> Iterable[Document]:
    for path in sorted(root.rglob("*.md")):
        if path.name == "log.md":
            continue
        try:
            document = load_document(path)
        except KnowledgeError:
            continue
        metadata = document.metadata
        kind = metadata.get("type")
        if kind not in ("Concept", "Reference"):
            continue
        if document_type is not None and kind != document_type:
            continue
        if subtype is not None and metadata.get(
            "concept_type" if kind == "Concept" else "reference_type"
        ) != subtype:
            continue
        document_tags = metadata.get("tags")
        if not isinstance(document_tags, list) or not all(
            tag in document_tags for tag in tags
        ):
            continue
        yield document


def render_search(root: Path, documents: Iterable[Document]) -> str:
    lines = [row(("document", "type", "subtype", "tags", "title"))]
    for document in documents:
        metadata = document.metadata
        kind = metadata["type"]
        subtype = metadata.get(
            "concept_type" if kind == "Concept" else "reference_type", ""
        )
        lines.append(row((
            document.path.relative_to(root).as_posix(),
            kind,
            subtype,
            ", ".join(str(tag) for tag in metadata["tags"]),
            metadata.get("title", ""),
        )))
    return "\n".join(lines) + "\n"
