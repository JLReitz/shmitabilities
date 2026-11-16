"""Shared text-report operations for the knowledge CLI and MCP server."""

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Sequence, Tuple, Union

from .confidence import evaluate_confidence, render_confidence
from .connections import collect_connections, render_connections
from .document import load_document
from .errors import KnowledgeError
from .investment import as_datetime, evaluate, load_policy
from .ontology import build_snapshot
from .paths import resolve_document_path
from .reading import expand_read, render_read
from .search import matching_documents, render_search
from .tsv import row
from .validation import verify


def select_root(root: Optional[Union[str, Path]]) -> Path:
    """Return the explicit or environment-selected knowledge tree root."""
    selected = root if root is not None else os.environ.get(
        "SHMIT_KNOWLEDGE_ROOT"
    )
    if selected is None:
        raise KnowledgeError(
            "--root is required when SHMIT_KNOWLEDGE_ROOT is unset"
        )
    return Path(selected).resolve()


def evaluation_time(raw: Optional[str]) -> datetime:
    """Return an explicit UTC evaluation time or the current UTC time."""
    return as_datetime(raw, "--as-of") if raw else datetime.now(timezone.utc)


def read_report(root: Path, documents: Sequence[str]) -> str:
    """Render documents and their required ancestor context as Markdown."""
    return render_read(
        root,
        expand_read(root, tuple(Path(document) for document in documents)),
    )


def search_report(
    root: Path,
    tags: Sequence[str] = (),
    document_type: Optional[str] = None,
    subtype: Optional[str] = None,
) -> str:
    """Render matching knowledge documents as TSV."""
    if not root.is_dir():
        raise KnowledgeError(f"{root}: knowledge tree root is not a directory")
    return render_search(
        root,
        matching_documents(root, tags, document_type, subtype),
    )


def connections_report(root: Path, document: str) -> str:
    """Render authored and derived connections from one Concept."""
    selected = load_document(resolve_document_path(root, Path(document)))
    return render_connections(
        root, selected, collect_connections(root, selected)
    )


def confidence_report(
    root: Path, document: str, recursive: bool = False
) -> str:
    """Render confidence for one Concept and selected linked Concepts."""
    selected = load_document(resolve_document_path(root, Path(document)))
    evaluation = evaluate_confidence(root, selected)
    return render_confidence(root, selected, evaluation, recursive)


def investment_report(
    root: Path, document: str, as_of: Optional[str] = None
) -> str:
    """Render the investment components for one Concept."""
    selected = load_document(resolve_document_path(root, Path(document)))
    evaluated = evaluation_time(as_of)
    score = evaluate(root, selected, evaluated)
    lines = [
        row(("field", "value")),
        row(("concept", selected.path)),
        row(("evaluated", evaluated.isoformat())),
        row(("confidence", f"{score.confidence:.6f}")),
        row(("consistency", f"{score.consistency:.6f}")),
    ]
    if score.connection is not None:
        lines.extend((
            row(("fulfilled", score.fulfilled)),
            row(("open", score.open)),
            row(("qualifying_links", score.qualifying_links)),
            row(("target", load_policy(root).connection_target)),
            row(("connection", f"{score.connection:.6f}")),
        ))
    lines.append(row(("investment", f"{score.total:.6f}")))
    return "\n".join(lines) + "\n"


def verification_report(
    root: Path, document: str, as_of: Optional[str] = None
) -> Tuple[str, bool]:
    """Render verification findings and return whether the document is valid."""
    selected = load_document(resolve_document_path(root, Path(document)))
    evaluated = evaluation_time(as_of)
    findings = verify(root, selected, evaluated)
    errors = [finding for finding in findings if finding.severity == "error"]
    lines = [
        row(("field", "value")),
        row(("document", selected.path)),
        row(("evaluated", evaluated.isoformat())),
        row(("result", "invalid" if errors else "valid")),
    ]
    for finding in findings:
        field = finding.field if finding.severity == "error" else "warning"
        lines.append(row((field, finding.message)))
    return "\n".join(lines) + "\n", not errors


def ontology_report(root: Path, report: str) -> str:
    """Render one ontology report as TSV."""
    if not root.is_dir():
        raise KnowledgeError(f"{root}: knowledge tree root is not a directory")
    snapshot = build_snapshot(root)
    if report == "terms":
        lines = [row(("concept", "tag", "term", "kind", "match"))]
        for item in sorted(
            snapshot.terms,
            key=lambda term: (
                str(term.concept), term.tag, term.term, term.kind
            ),
        ):
            lines.append(row((
                "/" + item.concept.resolve().relative_to(root).as_posix(),
                item.tag,
                item.term,
                item.kind,
                item.match,
            )))
        return "\n".join(lines) + "\n"
    if report == "facts":
        lines = [row(("subject", "predicate", "object", "source", "link"))]
        for item in sorted(
            snapshot.facts,
            key=lambda fact: (fact.subject, fact.predicate, fact.object),
        ):
            lines.append(row((
                item.subject,
                item.predicate,
                item.object,
                "inferred" if item.derived else "asserted",
                item.link,
            )))
        return "\n".join(lines) + "\n"
    lines = [row((
        "concept", "class", "property", "filler", "direction", "link"
    ))]
    for item in sorted(
        snapshot.requirements,
        key=lambda requirement: (
            str(requirement.concept),
            requirement.source_class,
            requirement.property,
            requirement.target_class,
        ),
    ):
        concept = "/" + item.concept.resolve().relative_to(root).as_posix()
        for link in item.links or (None,):
            lines.append(row((
                concept,
                item.source_class,
                item.property,
                item.target_class,
                "outbound",
                "/" + link.resolve().relative_to(root).as_posix()
                if link is not None else "",
            )))
    return "\n".join(lines) + "\n"
