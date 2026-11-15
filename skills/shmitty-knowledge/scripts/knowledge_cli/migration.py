"""Plan and apply one explicitly selected knowledge-tree migration."""

import os
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from .errors import KnowledgeError
from .paths import (
    INLINE_LINK_PATTERN,
    REFERENCE_DEFINITION_PATTERN,
    link_destination,
    markdown_path_destinations,
    resolve_internal,
    without_fenced_code,
)


LEGACY_ROLES = {
    "vocabulary.ttl": "Shared",
    "requirements.ttl": "Requirement",
    "axioms.ttl": "Inference",
}
RECEIPT_NAME = "knowledge-migration-receipt.json"


@dataclass(frozen=True)
class MigrationPlan:
    """A validated, root-local set of path and content changes."""

    root: Path
    moves: tuple
    rewrites: tuple
    conflicts: tuple
    ontology: str = ""
    role_counts: tuple = ()
    fingerprint: tuple = ()


def _convert_ontology(root):
    """Merge legacy root roles when each axiom has one unambiguous role."""
    present = [name for name in LEGACY_ROLES if (root / name).exists()]
    if not present:
        return "", ()
    if len(present) != len(LEGACY_ROLES):
        return "", ("legacy ontology file set is incomplete",)
    if (root / "ontology.ttl").exists():
        return "", ("ontology.ttl already exists",)
    try:
        import rdflib as rdf
    except ImportError as exc:
        raise KnowledgeError("migration requires rdflib") from exc
    graph = rdf.Graph()
    assignments = {}
    conflicts = []
    role_property = rdf.URIRef("urn:shmitty:knowledge:role")

    def shared_declaration(triple):
        return triple[1] in (rdf.RDFS.label, rdf.RDFS.comment) or (
            triple[1] == rdf.RDF.type and triple[2] in (
                rdf.OWL.Ontology, rdf.OWL.AnnotationProperty, rdf.OWL.Class,
                rdf.RDFS.Class, rdf.OWL.ObjectProperty,
                rdf.OWL.DatatypeProperty, rdf.OWL.NamedIndividual,
                rdf.RDF.Property,
            )
        )

    for name, role in LEGACY_ROLES.items():
        local = rdf.Graph()
        try:
            local.parse((root / name).as_posix(), format="turtle")
        except Exception as exc:
            return "", (f"{name}: invalid Turtle: {exc}",)
        for triple in local:
            if shared_declaration(triple):
                graph.add(triple)
                continue
            previous = assignments.get(triple)
            if previous and previous != role:
                conflicts.append(f"{name}: axiom appears in both {previous} and {role}")
            assignments[triple] = role
            graph.add(triple)
    if conflicts:
        return "", tuple(sorted(set(conflicts)))
    graph.add((role_property, rdf.RDF.type, rdf.OWL.AnnotationProperty))
    for triple, role in assignments.items():
        node = rdf.BNode()
        graph.add((node, rdf.RDF.type, rdf.OWL.Axiom))
        graph.add((node, rdf.OWL.annotatedSource, triple[0]))
        graph.add((node, rdf.OWL.annotatedProperty, triple[1]))
        graph.add((node, rdf.OWL.annotatedTarget, triple[2]))
        graph.add((node, role_property, rdf.Literal(role)))
    return graph.serialize(format="turtle"), ()


def _role_counts(root):
    """Count authored triples by legacy role for the pre-mutation report."""
    if not all((root / name).exists() for name in LEGACY_ROLES):
        return ()
    import rdflib as rdf

    counts = []
    for name, role in LEGACY_ROLES.items():
        graph = rdf.Graph().parse((root / name).as_posix(), format="turtle")
        counts.append((role, len(graph)))
    return tuple(counts)


def _destination(root, path):
    relative = path.relative_to(root)
    parts = relative.parts
    if parts[:2] == ("references", "packages"):
        return root.joinpath("tools", *parts[2:])
    if parts[:1] == ("references",):
        return root.joinpath("sources", *parts[1:])
    return path


def _rewrite_text(root, source, destination, moves):
    text = source.read_text(encoding="utf-8")
    replacements = {}
    for target in markdown_path_destinations(text):
        parsed = urlsplit(target)
        resolved = resolve_internal(root, source, target)
        if resolved is None:
            continue
        new_target = moves.get(resolved, resolved)
        if new_target == resolved and destination == source:
            continue
        if parsed.path.startswith("/"):
            path = "/" + new_target.relative_to(root).as_posix()
        else:
            path = os.path.relpath(new_target, destination.parent)
        replacements[target] = urlunsplit(("", "", path, parsed.query, parsed.fragment))
    masked = without_fenced_code(text)
    edits = []
    for match in INLINE_LINK_PATTERN.finditer(masked):
        destination_text = match.group(1)
        old = link_destination(destination_text)
        if old not in replacements:
            continue
        start = match.start(1) + destination_text.index(old)
        edits.append((start, start + len(old), replacements[old]))
    for match in REFERENCE_DEFINITION_PATTERN.finditer(masked):
        group = 2 if match.group(2) is not None else 3
        old = match.group(group)
        if old in replacements:
            edits.append((match.start(group), match.end(group), replacements[old]))
    for start, end, new in sorted(edits, reverse=True):
        text = text[:start] + new + text[end:]
    return text


def plan_migration(root):
    """Report moves, incoming link rewrites, and blocking conflicts before mutation."""
    root = Path(root).resolve()
    if not root.is_dir():
        raise KnowledgeError(f"{root}: knowledge tree root is not a directory")
    moves = {}
    conflicts = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            conflicts.append(f"{path}: symbolic links require manual migration")
            continue
        if not path.is_file():
            continue
        destination = _destination(root, path)
        if destination != path:
            moves[path] = destination
            if destination.exists():
                conflicts.append(f"{destination}: destination already exists")
    ontology, ontology_conflicts = _convert_ontology(root)
    conflicts.extend(ontology_conflicts)
    rewrites = []
    for source in sorted(root.rglob("*.md")):
        destination = moves.get(source, source)
        updated = _rewrite_text(root, source, destination, moves)
        if updated != source.read_text(encoding="utf-8"):
            rewrites.append((source, destination, updated))
    counts = ()
    if all((root / name).exists() for name in LEGACY_ROLES):
        try:
            counts = _role_counts(root)
        except Exception:
            pass
    return MigrationPlan(root, tuple(sorted(moves.items())), tuple(rewrites),
                         tuple(conflicts), ontology, counts, _tree_fingerprint(root))


def _apply_changes(plan):
    """Perform a previously checked plan inside one tree."""
    root = plan.root
    if plan.conflicts:
        raise KnowledgeError("migration conflicts: " + "; ".join(plan.conflicts))
    for source, destination in plan.moves:
        destination.parent.mkdir(parents=True, exist_ok=True)
        source.rename(destination)
    for _, destination, content in plan.rewrites:
        destination.write_text(content, encoding="utf-8")
    if plan.ontology:
        (plan.root / "ontology.ttl").write_text(plan.ontology, encoding="utf-8")
        for name in LEGACY_ROLES:
            (plan.root / name).unlink()
    for directory in sorted(plan.root.rglob("*"), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()


def _verify_result(plan):
    """Check migrated paths and the composed root ontology."""
    for source, destination in plan.moves:
        if source.exists() or not destination.is_file():
            raise KnowledgeError(f"{destination}: migrated path verification failed")
    if plan.ontology:
        from .ontology_modules import load_views
        from .ontology import build_snapshot

        if any((plan.root / name).exists() for name in LEGACY_ROLES):
            raise KnowledgeError("legacy ontology files remain after migration")
        load_views(plan.root, (plan.root / "index.md",))
        build_snapshot(plan.root)
    root_index = plan.root / "index.md"
    if root_index.is_file() and root_index.read_text(encoding="utf-8").startswith("---"):
        from datetime import datetime, timezone

        from .document import load_document
        from .validation import verify

        now = datetime.now(timezone.utc)
        for path in sorted(plan.root.rglob("*.md")):
            if path == root_index or path.name == "log.md":
                continue
            document = load_document(path)
            if document.metadata.get("type") not in ("Concept", "Reference"):
                continue
            findings = verify(plan.root, document, now)
            errors = [item for item in findings if item.severity == "error"]
            if errors:
                raise KnowledgeError(
                    f"{path}: post-migration verification: "
                    + "; ".join(f"{item.field}: {item.message}" for item in errors)
                )


def _tree_fingerprint(root):
    """Record every file so a reviewed plan cannot apply to a changed tree."""
    return tuple(
        (path.relative_to(root).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest())
        for path in sorted(root.rglob("*")) if path.is_file()
    )


def _restore_changed_paths(plan, backup):
    """Undo only paths that this migration may have changed."""
    changed = {source for source, _ in plan.moves}
    changed.update(destination for _, destination in plan.moves)
    changed.update(destination for _, destination, _ in plan.rewrites)
    if plan.ontology:
        changed.add(plan.root / "ontology.ttl")
        changed.update(plan.root / name for name in LEGACY_ROLES)
    for path in changed:
        saved = backup / path.relative_to(plan.root)
        if saved.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(saved, path)
        elif path.is_file():
            path.unlink()
    for directory in sorted(plan.root.rglob("*"), reverse=True):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()


def apply_migration(plan):
    """Stage, verify, and apply a conflict-free explicit-root plan.

    The original tree is restored from a temporary backup if the final
    mutation or validation fails. A successful result is a path receipt.
    """
    if plan.conflicts:
        raise KnowledgeError("migration conflicts: " + "; ".join(plan.conflicts))
    if _tree_fingerprint(plan.root) != plan.fingerprint:
        raise KnowledgeError("knowledge tree changed since migration preflight")
    receipt_path = plan.root / RECEIPT_NAME
    if receipt_path.exists():
        raise KnowledgeError(f"{receipt_path}: migration receipt already exists")
    original_fingerprint = _tree_fingerprint(plan.root)
    with tempfile.TemporaryDirectory(prefix="knowledge-migration-") as temporary:
        backup = Path(temporary) / "backup"
        staged = Path(temporary) / "staged"
        shutil.copytree(plan.root, backup)
        shutil.copytree(plan.root, staged)
        staged_plan = plan_migration(staged)
        if staged_plan.conflicts:
            raise KnowledgeError("staged migration conflicts: " + "; ".join(staged_plan.conflicts))
        _apply_changes(staged_plan)
        _verify_result(staged_plan)
        if _tree_fingerprint(plan.root) != original_fingerprint:
            raise KnowledgeError("knowledge tree changed during migration staging")
        try:
            _apply_changes(plan)
            _verify_result(plan)
            receipt_path.write_text(json.dumps({
                "root": str(plan.root),
                "moves": [[str(source.relative_to(plan.root)), str(destination.relative_to(plan.root))]
                          for source, destination in plan.moves],
                "rewrites": [str(source.relative_to(plan.root)) for source, _, _ in plan.rewrites],
                "ontology_roles": dict(plan.role_counts),
                "ontology_converted": bool(plan.ontology),
            }, indent=2) + "\n", encoding="utf-8")
        except Exception:
            _restore_changed_paths(plan, backup)
            raise
    return tuple((str(source.relative_to(plan.root)),
                  str(destination.relative_to(plan.root)))
                 for source, destination in plan.moves)
