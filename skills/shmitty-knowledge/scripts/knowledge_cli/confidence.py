from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

from .connections import (
    ConnectionGraph,
    collect_connections,
    document_tags,
    topical_tags,
    tree_path,
)
from .document import Document, load_document
from .errors import KnowledgeError
from .tsv import row


@dataclass(frozen=True)
class ConfidenceEvaluation:
    graph: ConnectionGraph
    scores: Dict[Path, float]

    def score(self, document: Document) -> float:
        return self.scores[document.path.resolve()]

    def documents(
        self, document: Document, recursive: bool
    ) -> Tuple[Path, ...]:
        root_path = document.path.resolve()
        if recursive:
            return tuple(self.graph.concepts)
        return (root_path,) + self.graph.concept_links.get(root_path, ())


def citation_coverage(
    root: Path, concept: Document, graph: ConnectionGraph
) -> float:
    topics = set(topical_tags(root, concept))
    if not topics:
        raise KnowledgeError(
            f"{concept.path}: at least one topical tag is required"
        )
    covered: Set[str] = set()
    for path in graph.reference_links.get(concept.path.resolve(), ()):
        covered.update(topics.intersection(document_tags(load_document(path))))
    return len(covered) / len(topics)


def combine_confidence(coverage: float, linked_average: float) -> float:
    total = coverage + linked_average
    return total / 2.0 if coverage and linked_average else total


def evaluate_confidence(
    root: Path, document: Document
) -> ConfidenceEvaluation:
    graph = collect_connections(root, document)
    scores: Dict[Path, float] = {}
    evaluating: Set[Path] = set()

    def evaluate_path(path: Path) -> Optional[float]:
        if path in scores:
            return scores[path]
        if path in evaluating:
            return None
        evaluating.add(path)
        linked_scores = []
        for target in graph.concept_links.get(path, ()):
            score = evaluate_path(target)
            if score is not None:
                linked_scores.append(score)
        linked_average = (
            sum(linked_scores) / len(linked_scores) if linked_scores else 0.0
        )
        score = combine_confidence(
            citation_coverage(root, graph.concepts[path], graph),
            linked_average,
        )
        evaluating.remove(path)
        scores[path] = score
        return score

    evaluate_path(document.path.resolve())
    return ConfidenceEvaluation(graph, scores)


def render_confidence(
    root: Path,
    document: Document,
    evaluation: ConfidenceEvaluation,
    recursive: bool,
) -> str:
    lines = [row(("concept", "confidence"))]
    for path in evaluation.documents(document, recursive):
        lines.append(
            row((tree_path(root, path), f"{evaluation.scores[path]:.6f}"))
        )
    return "\n".join(lines) + "\n"
