from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set, Tuple

from .document import Document, load_document
from .errors import KnowledgeError
from .paths import markdown_targets, resolve_internal
from .tsv import row


@dataclass(frozen=True)
class Connection:
    source: Path
    target: Path
    document_type: str
    shared_tags: Tuple[str, ...]
    depth: int


@dataclass(frozen=True)
class ConnectionGraph:
    connections: Tuple[Connection, ...]
    concepts: Dict[Path, Document]
    concept_links: Dict[Path, Tuple[Path, ...]]
    reference_links: Dict[Path, Tuple[Path, ...]]


def document_tags(document: Document) -> Tuple[str, ...]:
    tags = document.metadata.get("tags", [])
    if not isinstance(tags, list) or any(
        not isinstance(tag, str) for tag in tags
    ):
        raise KnowledgeError(
            f"{document.path}: tags must be a list of strings"
        )
    return tuple(tags)


def topical_tags(root: Path, document: Document) -> Tuple[str, ...]:
    try:
        relative = document.path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise KnowledgeError(
            f"{document.path}: document is outside the tree root"
        ) from exc
    return tuple(relative.parent.parts)


def term_tags(root: Path, document: Document) -> Tuple[str, ...]:
    topical = set(topical_tags(root, document))
    return tuple(tag for tag in document_tags(document) if tag not in topical)


def require_valid_tags(root: Path, document: Document) -> None:
    tags = document_tags(document)
    if len(tags) != len(set(tags)):
        raise KnowledgeError(
            f"{document.path}: duplicate tags are not allowed"
        )
    for tag in topical_tags(root, document):
        if tag not in tags:
            raise KnowledgeError(
                f"{document.path}: missing required topical tag: {tag}"
            )
    if not term_tags(root, document):
        raise KnowledgeError(
            f"{document.path}: at least one term tag is required"
        )


def implicit_index_targets(source: Document) -> Tuple[Path, ...]:
    if (
        source.path.name != "index.md"
        or source.metadata.get("type") != "Concept"
    ):
        return ()
    targets = []
    for child in source.path.parent.iterdir():
        if (
            child.resolve() == source.path.resolve()
            or child.name in {"index.md", "log.md"}
        ):
            continue
        if child.is_dir():
            targets.append(child / "index.md")
        elif child.suffix == ".md":
            targets.append(child)
    return tuple(sorted(path.resolve() for path in targets))


def consumable_targets(root: Path, source: Document) -> Tuple[Path, ...]:
    targets: Set[Path] = set(implicit_index_targets(source))
    definition_text = source.body + "\n" + source.contents
    for raw in markdown_targets(source.body, definition_text):
        target = resolve_internal(root, source.path, raw)
        if target is None:
            raise KnowledgeError(
                f"{source.path}: external or fragment link is not "
                f"consumable: {raw}"
            )
        if not target.exists():
            raise KnowledgeError(
                f"{source.path}: link target does not exist: {target}"
            )
        if target.suffix != ".md":
            raise KnowledgeError(
                f"{source.path}: link target is not a Markdown "
                f"document: {target}"
            )
        if target.name == "log.md" or (
            target.name == "index.md"
            and load_document(target).metadata.get("type")
            not in {"Concept", "Reference"}
        ):
            raise KnowledgeError(
                f"{source.path}: link targets reserved "
                f"infrastructure: {target}"
            )
        target_type = load_document(target).metadata.get("type")
        if target_type not in {"Concept", "Reference"}:
            raise KnowledgeError(
                f"{source.path}: link target is not consumable "
                f"knowledge: {target}"
            )
        targets.add(target.resolve())
    return tuple(sorted(targets))


def collect_connections(root: Path, concept: Document) -> ConnectionGraph:
    if concept.metadata.get("type") != "Concept":
        raise KnowledgeError(
            f"{concept.path}: connections apply only to Concept documents"
        )

    root = root.resolve()
    require_valid_tags(root, concept)
    requested_tags = set(document_tags(concept))
    concepts: Dict[Path, Document] = {concept.path.resolve(): concept}
    concept_links: Dict[Path, Tuple[Path, ...]] = {}
    reference_links: Dict[Path, Tuple[Path, ...]] = {}
    connections: List[Connection] = []
    visited: Set[Path] = set()

    def walk(source: Document, depth: int) -> None:
        source_path = source.path.resolve()
        if source_path in visited:
            return
        visited.add(source_path)
        linked_concepts: List[Path] = []

        linked_references: List[Path] = []
        for target in consumable_targets(root, source):
            target_document = load_document(target)
            require_valid_tags(root, target_document)
            document_type = target_document.metadata.get("type")
            target_path = target.resolve()
            shared_tags = tuple(
                tag
                for tag in document_tags(target_document)
                if tag in requested_tags
            )
            connections.append(
                Connection(
                    source_path, target_path, document_type, shared_tags, depth
                )
            )
            if document_type == "Concept":
                concepts[target_path] = target_document
                linked_concepts.append(target_path)
            else:
                linked_references.append(target_path)

        concept_links[source_path] = tuple(linked_concepts)
        reference_links[source_path] = tuple(linked_references)
        for target_path in linked_concepts:
            walk(concepts[target_path], depth + 1)

    walk(concept, 1)
    return ConnectionGraph(
        tuple(connections), concepts, concept_links, reference_links
    )


def tree_path(root: Path, path: Path) -> str:
    return "/" + path.resolve().relative_to(root.resolve()).as_posix()


def render_connections(
    root: Path, concept: Document, graph: ConnectionGraph
) -> str:
    lines = [row(("depth", "source", "link", "type", "shared_tags"))]
    for connection in graph.connections:
        tags = ", ".join(connection.shared_tags)
        lines.append(
            row(
                (
                    connection.depth,
                    tree_path(root, connection.source),
                    tree_path(root, connection.target),
                    connection.document_type,
                    tags,
                )
            )
        )
    return "\n".join(lines) + "\n"
