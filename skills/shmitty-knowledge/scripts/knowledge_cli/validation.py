from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlsplit

from .confidence import evaluate_confidence
from .connections import (
    cluster_tags,
    document_tags,
    implicit_index_targets,
    topical_tags,
)
from .document import Document, load_document
from .errors import KnowledgeError
from .investment import as_datetime, history_inputs, load_policy
from .paths import markdown_path_destinations, markdown_targets, resolve_internal
from .reading import concept_indexes, reference_indexes


SANCTIONED_EXECUTION_TYPES = {"Command", "Computation"}
SOURCE_MATCH_TYPES = SANCTIONED_EXECUTION_TYPES | {"Package"}


@dataclass(frozen=True)
class Finding:
    field: str
    message: str


def confidence_required(root: Path) -> bool:
    index = load_document(root / "index.md")
    confidence = index.metadata.get("confidence", {})
    if not isinstance(confidence, dict):
        raise KnowledgeError(f"{index.path}: invalid confidence policy")
    required = confidence.get("required", False)
    if not isinstance(required, bool):
        raise KnowledgeError(
            f"{index.path}: confidence.required must be a boolean"
        )
    return required


def reference_root(root: Path, path: Path) -> Path:
    try:
        relative = path.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise KnowledgeError(
            f"{path}: document is outside the tree root"
        ) from exc
    if len(relative.parts) < 3 or relative.parts[0] != "references":
        raise KnowledgeError(
            f"{path}: document is outside the tree-root references directory"
        )
    return root.resolve() / "references"


def tag_findings(root: Path, document: Document) -> List[Finding]:
    try:
        tags = document_tags(document)
        required = cluster_tags(root, document)
        topics = topical_tags(root, document)
    except KnowledgeError as exc:
        return [Finding("tags", str(exc))]
    findings = []
    if len(tags) != len(set(tags)):
        findings.append(Finding("tags", "duplicate tags are not allowed"))
    for tag in required:
        if tag not in tags:
            findings.append(
                Finding("tags", f"missing required cluster tag: {tag}")
            )
    if not topics:
        findings.append(
            Finding("tags", "at least one topical tag is required")
        )
    return findings


def is_resource_url(value: str) -> bool:
    if value != value.strip() or any(char.isspace() for char in value):
        return False
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        parsed.port
    except ValueError:
        return False
    return True


def normalize_resource_url(value: str) -> str:
    parsed = urlsplit(value)
    return parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        fragment="",
    ).geturl()


def source_match_findings(root: Path, document: Document) -> List[Finding]:
    if document.metadata.get("reference_type") not in SOURCE_MATCH_TYPES:
        return []
    resource = document.metadata.get("resource")
    if not isinstance(resource, str) or not is_resource_url(resource):
        return []
    normalized = normalize_resource_url(resource)
    references = root / "references"
    if references.exists():
        for path in references.rglob("*.md"):
            try:
                candidate = load_document(path)
            except KnowledgeError:
                continue
            if candidate.metadata.get("type") != "Reference":
                continue
            if candidate.metadata.get("reference_type") is not None:
                continue
            candidate_resource = candidate.metadata.get("resource")
            if (
                isinstance(candidate_resource, str)
                and is_resource_url(candidate_resource)
                and normalize_resource_url(candidate_resource) == normalized
            ):
                return []
    return [
        Finding(
            "resource",
            "Package and sanctioned execution resources must match an "
            f"ordinary source Reference: {resource}",
        )
    ]


def metadata_findings(document: Document) -> List[Finding]:
    findings = []
    for field in ("title", "description"):
        value = document.metadata.get(field)
        if not isinstance(value, str) or not value.strip():
            findings.append(
                Finding(field, f"{field} must be a non-empty string")
            )
    if document.metadata.get("type") == "Reference":
        for field in ("resource", "resource_type"):
            value = document.metadata.get(field)
            if not isinstance(value, str) or not value.strip():
                findings.append(
                    Finding(field, f"{field} must be a non-empty string")
                )
        try:
            as_datetime(document.metadata.get("timestamp"), "timestamp")
        except KnowledgeError as exc:
            findings.append(Finding("timestamp", str(exc)))
        resource = document.metadata.get("resource")
        if (
            isinstance(resource, str)
            and resource.strip()
            and not is_resource_url(resource)
        ):
            findings.append(
                Finding("resource", "resource must be an HTTP or HTTPS URL")
            )
    return findings


def required_string(container, field: str, path: str) -> List[Finding]:
    value = container.get(field) if isinstance(container, dict) else None
    if isinstance(value, str) and value.strip():
        return []
    return [Finding(path, f"{path} must be a non-empty string")]


def receipt_findings(document: Document) -> List[Finding]:
    receipt = document.metadata.get("receipt")
    if isinstance(receipt, list):
        return []
    return [Finding("receipt", "receipt must be a list")]


def attester_findings(document: Document) -> List[Finding]:
    return required_string(
        document.metadata.get("attester"),
        "command",
        "attester.command",
    )


def subtype_findings(document: Document) -> List[Finding]:
    subtype = document.metadata.get("reference_type")
    if subtype == "Command":
        return (
            required_string(document.metadata, "runtime", "runtime")
            + required_string(document.metadata, "command", "command")
            + receipt_findings(document)
            + attester_findings(document)
        )
    if subtype != "Computation":
        return []
    findings = receipt_findings(document) + attester_findings(document)
    commands = document.metadata.get("commands")
    if not isinstance(commands, list):
        return findings + [Finding(
            "commands", "commands must contain at least two entries"
        )]
    if len(commands) < 2:
        findings.append(Finding(
            "commands", "commands must contain at least two entries"
        ))
    for index, command in enumerate(commands):
        findings.extend(
            required_string(
                command,
                "runtime",
                f"commands[{index}].runtime",
            )
        )
        findings.extend(
            required_string(
                command,
                "command",
                f"commands[{index}].command",
            )
        )
    return findings


def link_findings(
    root: Path,
    document: Document,
    references_only: bool,
    link_text: Optional[str] = None,
    definition_text: Optional[str] = None,
    forbidden_directory: Optional[Path] = None,
) -> List[Finding]:
    findings = []
    if link_text is None:
        link_text = document.body + "\n" + document.contents
    for raw in markdown_targets(link_text, definition_text):
        try:
            target = resolve_internal(root, document.path, raw)
        except KnowledgeError as exc:
            findings.append(Finding("body", str(exc)))
            continue
        if target is None:
            findings.append(
                Finding(
                    "body",
                    f"external or fragment link is not consumable: {raw}",
                )
            )
            continue
        if not target.exists():
            findings.append(
                Finding("body", f"link target does not exist: {target}")
            )
            continue
        if target.suffix != ".md":
            findings.append(
                Finding(
                    "body",
                    f"link target is not a Markdown document: {target}",
                )
            )
            continue
        if target.name == "log.md":
            findings.append(
                Finding(
                    "body",
                    f"link targets reserved infrastructure: {target}",
                )
            )
            continue
        try:
            target_document = load_document(target)
        except KnowledgeError as exc:
            if target.name == "index.md":
                findings.append(
                    Finding(
                        "body",
                        f"link targets untyped navigation index: {target}",
                    )
                )
            else:
                findings.append(Finding("body", str(exc)))
            continue
        if target_document.metadata.get("type") not in {
            "Concept",
            "Reference",
        }:
            message = (
                "link targets untyped navigation index"
                if target.name == "index.md"
                else "link target is not consumable knowledge"
            )
            findings.append(Finding("body", f"{message}: {target}"))
            continue
        if forbidden_directory is not None:
            try:
                target.resolve().relative_to(forbidden_directory.resolve())
            except ValueError:
                pass
            else:
                findings.append(
                    Finding(
                        "body",
                        "index abstract link targets its own directory: "
                        f"{target}",
                    )
                )
        if references_only:
            try:
                reference_root(root, target)
            except KnowledgeError:
                findings.append(
                    Finding(
                        "body",
                        "Reference link leaves the references directory: "
                        f"{target}",
                    )
                )
    return findings


def duplicate_path_findings(
    root: Path,
    document: Document,
) -> List[Finding]:
    seen = set()
    reported = set()
    findings = []
    text = document.body + "\n" + document.contents
    for raw in markdown_path_destinations(text):
        try:
            target = resolve_internal(root, document.path, raw)
        except KnowledgeError:
            continue
        if target is None:
            continue
        target = target.resolve()
        if target in seen and target not in reported:
            findings.append(
                Finding(
                    "body",
                    "duplicate link filepath; use one reference-style "
                    f"definition: {target}",
                )
            )
            reported.add(target)
        seen.add(target)
    return findings


def index_contents_findings(root: Path, document: Document) -> List[Finding]:
    linked = set()
    definition_text = document.body + "\n" + document.contents
    for raw in markdown_targets(document.contents, definition_text):
        try:
            target = resolve_internal(root, document.path, raw)
        except KnowledgeError:
            continue
        if target is not None:
            linked.add(target.resolve())

    findings = []
    for child in sorted(document.path.parent.iterdir()):
        if child.name in {"index.md", "log.md"}:
            continue
        target = child / "index.md" if child.is_dir() else child
        if target.resolve() not in linked:
            findings.append(
                Finding(
                    "contents",
                    "index table of contents is missing a level entry: "
                    f"{child}",
                )
            )
    return findings


def verify(root: Path, document: Document, as_of: datetime) -> List[Finding]:
    findings: List[Finding] = metadata_findings(document) + tag_findings(
        root, document
    )
    findings.extend(duplicate_path_findings(root, document))
    document_type = document.metadata.get("type")
    is_index = document.path.name == "index.md"
    if is_index:
        definition_text = document.body + "\n" + document.contents
        if not document.has_index_separator:
            findings.append(
                Finding(
                    "body",
                    "index.md requires a horizontal separator with a "
                    "blank line before and after it",
                )
            )
        findings.extend(
            link_findings(
                root,
                document,
                references_only=False,
                link_text=document.body,
                definition_text=definition_text,
                forbidden_directory=document.path.parent,
            )
        )
        findings.extend(index_contents_findings(root, document))
    if document_type == "Reference":
        findings.extend(subtype_findings(document))
        findings.extend(source_match_findings(root, document))
        try:
            reference_root(root, document.path)
            indexes = list(reference_indexes(root, document))
        except KnowledgeError as exc:
            return findings + [Finding("body", str(exc))]
        for index_path in indexes:
            if index_path.resolve() == document.path.resolve():
                continue
            if not index_path.exists():
                findings.append(
                    Finding(
                        "body",
                        f"missing required index.md: {index_path}",
                    )
                )
            elif load_document(index_path).metadata.get(
                "type"
            ) != "Reference":
                findings.append(
                    Finding(
                        "body",
                        f"index.md is not a Reference: {index_path}",
                    )
                )
        findings.extend(
            link_findings(
                root,
                document,
                references_only=True,
                link_text=document.contents if is_index else None,
                definition_text=definition_text if is_index else None,
            )
        )
        return findings
    if document_type != "Concept":
        return findings + [
            Finding("type", "target must be a Concept or Reference document")
        ]
    for topic_index in concept_indexes(root, document):
        if topic_index.resolve() == document.path.resolve():
            continue
        if not topic_index.exists():
            findings.append(
                Finding(
                    "body",
                    f"missing required Concept index.md: {topic_index}",
                )
            )
            continue
        try:
            if load_document(topic_index).metadata.get("type") != "Concept":
                findings.append(
                    Finding(
                        "body",
                        "topic index.md is not a Concept: "
                        f"{topic_index}",
                    )
                )
        except KnowledgeError as exc:
            findings.append(Finding("body", str(exc)))
    findings.extend(
        link_findings(
            root,
            document,
            references_only=False,
            link_text=document.contents if is_index else None,
            definition_text=definition_text if is_index else None,
        )
    )

    for target in implicit_index_targets(document):
        if not target.exists():
            findings.append(
                Finding(
                    "body", f"implicit child target does not exist: {target}"
                )
            )
            continue
        try:
            if load_document(target).metadata.get("type") not in {
                "Concept", "Reference"
            }:
                findings.append(
                    Finding(
                        "body",
                        "implicit child is not consumable knowledge: "
                        f"{target}",
                    )
                )
        except KnowledgeError as exc:
            findings.append(Finding("body", str(exc)))

    try:
        history_inputs(document, load_policy(root), as_of)
    except KnowledgeError as exc:
        findings.append(Finding("history", str(exc)))
    try:
        if (
            document.body.strip()
            and confidence_required(root)
            and evaluate_confidence(root, document).score(document) == 0.0
        ):
            findings.append(
                Finding(
                    "confidence",
                    "non-open Concept has zero confidence while "
                    "confidence.required is true",
                )
            )
    except KnowledgeError as exc:
        findings.append(Finding("confidence", str(exc)))
    return findings
