from dataclasses import replace
from pathlib import Path
from typing import Iterable, List, Set

from .document import Document, load_document, load_index_for_read
from .errors import KnowledgeError
from .paths import resolve_document_path


def tree_path(root: Path, path: Path) -> str:
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise KnowledgeError(
            f"{path}: document is outside the tree root"
        ) from exc
    return "/" + relative.as_posix()


def reference_indexes(root: Path, document: Document) -> Iterable[Path]:
    relative = Path(tree_path(root, document.path).lstrip("/"))
    if len(relative.parts) < 3 or relative.parts[0] != "references":
        raise KnowledgeError(
            f"{document.path}: Reference document is outside the tree-root "
            "references directory"
        )
    reference_root = root.resolve() / "references"
    current = reference_root
    for part in relative.parent.parts[1:]:
        current = current / part
        if current == reference_root / "packages":
            continue
        yield current / "index.md"


def concept_indexes(root: Path, document: Document) -> Iterable[Path]:
    relative = Path(tree_path(root, document.path).lstrip("/"))
    if len(relative.parts) < 2 or relative.parts[0] == "references":
        raise KnowledgeError(
            f"{document.path}: Concept document is outside the knowledge tree"
        )
    current = root.resolve()
    for part in relative.parent.parts:
        current = current / part
        yield current / "index.md"


def expand_read(root: Path, paths: Iterable[Path]) -> List[Document]:
    result: List[Document] = []
    emitted_indexes: Set[Path] = set()
    for raw_path in paths:
        path = resolve_document_path(root, raw_path)
        tree_path(root, path)
        document = (
            load_index_for_read(path)
            if path.name == "index.md"
            else load_document(path)
        )
        if document.metadata.get("type") == "Reference":
            for index_path in reference_indexes(root, document):
                index_path = index_path.resolve()
                if index_path == path or index_path in emitted_indexes:
                    continue
                if not index_path.exists():
                    raise KnowledgeError(
                        f"{index_path}: missing required index.md"
                    )
                index = load_document(index_path)
                if index.metadata.get("type") != "Reference":
                    raise KnowledgeError(
                        f"{index_path}: index.md must be a "
                        "Reference document"
                    )
                result.append(
                    replace(
                        index,
                        contents="",
                        has_index_separator=False,
                    )
                )
                emitted_indexes.add(index_path)
        elif document.metadata.get("type") == "Concept":
            for index_path in concept_indexes(root, document):
                index_path = index_path.resolve()
                if index_path == path or index_path in emitted_indexes:
                    continue
                if not index_path.exists():
                    raise KnowledgeError(
                        f"{index_path}: missing required index.md"
                    )
                index = load_document(index_path)
                if index.metadata.get("type") != "Concept":
                    raise KnowledgeError(
                        f"{index_path}: index.md must be a Concept "
                        "document"
                    )
                result.append(
                    replace(
                        index,
                        contents="",
                        has_index_separator=False,
                    )
                )
                emitted_indexes.add(index_path)
        if path.name == "index.md":
            if path in emitted_indexes:
                for index, previous in enumerate(result):
                    if previous.path.resolve() == path:
                        result[index] = document
                        break
                continue
            emitted_indexes.add(path)
        result.append(document)
    return result


def render_read(root: Path, documents: Iterable[Document]) -> str:
    sections = []
    for document in documents:
        document_type = document.metadata.get("type")
        if document_type not in ("Reference", "Concept"):
            if document.path.name != "index.md":
                raise KnowledgeError(
                    f"{document.path}: type must be Reference or Concept"
                )
            lines = [f"# {tree_path(root, document.path)}"]
            content = document.contents or document.body
            if content.strip():
                lines.append(content.strip("\n"))
            sections.append("\n".join(lines))
            continue
        path = tree_path(root, document.path)
        tags = document.metadata.get("tags") or []
        lines = [
            f"# {path}",
            "**Tags:** " + ", ".join(str(tag) for tag in tags),
        ]
        if document_type == "Reference":
            lines.append(str(document.metadata.get("resource", "")))
        if document.body.strip():
            lines.append(document.body.strip("\n"))
        if document.has_index_separator:
            contents = document.contents.strip("\n")
            lines.append("---" + ("\n\n" + contents if contents else ""))
        sections.append("\n".join(lines))
    return "\n\n".join(sections) + ("\n" if sections else "")
