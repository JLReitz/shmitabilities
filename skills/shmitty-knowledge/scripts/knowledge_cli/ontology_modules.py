"""Load role-annotated topic ontology modules.

Logical triples use an ``owl:Axiom`` annotation with
``<urn:shmitty:knowledge:role>`` and exactly one literal value from
``Shared``, ``Requirement``, or ``Inference``. The root module applies to all
documents; each topic module applies to that topic and its descendants.
"""

from pathlib import Path

from .errors import KnowledgeError


ROLE_IRI = "urn:shmitty:knowledge:role"
ROLES = frozenset(("Shared", "Requirement", "Inference"))


def _axiom_key(graph, triple):
    """Represent a structural axiom independently of blank-node labels."""
    import rdflib as rdf

    def node_key(node, seen):
        if not isinstance(node, rdf.BNode):
            return (type(node).__name__, str(node))
        if node in seen:
            raise KnowledgeError("cyclic blank-node axiom structure")
        return (
            "BNode",
            tuple(
                sorted(
                    (str(predicate), node_key(target, seen | {node}))
                    for predicate, target in graph.predicate_objects(node)
                )
            ),
        )

    return tuple(node_key(node, set()) for node in triple)


def module_paths(root: Path, document: Path):
    """Yield root and ancestor-topic modules for a document in one tree.

    The root must contain ``ontology.ttl`` and the document must be inside
    the root. Topic modules are yielded from general to specific. Source and
    tool hierarchies use only the root module. Missing root or out-of-root
    paths raise ``KnowledgeError``.
    """
    root = root.resolve()
    document = document.resolve()
    try:
        relative = document.relative_to(root)
    except ValueError as exc:
        raise KnowledgeError(f"{document}: outside knowledge root {root}") from exc
    base = root / "ontology.ttl"
    if not base.is_file():
        raise KnowledgeError(f"{base}: required ontology file is missing")
    yield base
    directory = root
    for part in relative.parts[:-1]:
        directory /= part
        if part in ("sources", "tools"):
            break
        module = directory / "ontology.ttl"
        if module.is_file():
            yield module


def load_views(root: Path, endpoints):
    """Return shared, EL, and RL graphs for the endpoints' module union.

    ``endpoints`` contains document paths inside ``root``. This function
    reads each selected module once without changing files. A repeated
    logical axiom must retain its role. Role annotations are support metadata
    and do not enter the reasoning views. Unannotated nonlogical label/comment
    and ontology declarations enter all views. Invalid Turtle, imports,
    unannotated logical axioms, and conflicting roles raise
    ``KnowledgeError`` with source-path context.
    """
    try:
        import rdflib as rdf
    except ImportError as exc:
        raise KnowledgeError("ontology support requires rdflib") from exc
    paths = sorted(
        {path for endpoint in endpoints for path in module_paths(root, endpoint)}
    )
    shared, requirements, inferences = (rdf.Graph() for _ in range(3))
    assignments = {}
    structural_roles = {}
    role_property = rdf.URIRef(ROLE_IRI)
    for path in paths:
        graph = rdf.Graph()
        try:
            graph.parse(path.as_posix(), format="turtle", publicID=path.as_uri())
        except Exception as exc:
            raise KnowledgeError(f"{path}: invalid Turtle: {exc}") from exc
        if any(graph.triples((None, rdf.OWL.imports, None))):
            raise KnowledgeError(f"{path}: owl:imports is unsupported")
        plain_property = rdf.URIRef("urn:shmitty:knowledge:plainTag")
        if any(graph.triples((None, plain_property, None))) and (
            plain_property, rdf.RDF.type, rdf.OWL.AnnotationProperty
        ) not in graph:
            raise KnowledgeError(
                f"{path}: plainTag must be declared owl:AnnotationProperty"
            )
        for subject, value in graph.subject_objects(plain_property):
            if (subject, rdf.RDF.type, rdf.OWL.Ontology) not in graph or not isinstance(value, rdf.Literal):
                raise KnowledgeError(f"{path}: plainTag must be a literal annotation on an ontology")
        annotated = set()
        local_roles = {}
        axiom_nodes = set(graph.subjects(rdf.RDF.type, rdf.OWL.Axiom))
        for node in axiom_nodes:
            sources = list(graph.objects(node, rdf.OWL.annotatedSource))
            predicates = list(graph.objects(node, rdf.OWL.annotatedProperty))
            targets = list(graph.objects(node, rdf.OWL.annotatedTarget))
            roles = list(graph.objects(node, role_property))
            if (len(sources), len(predicates), len(targets), len(roles)) != (
                1,
                1,
                1,
                1,
            ):
                raise KnowledgeError(
                    f"{path}: axiom {node} requires one triple and one role"
                )
            role = roles[0]
            if not isinstance(role, rdf.Literal) or str(role) not in ROLES:
                raise KnowledgeError(f"{path}: axiom {node} has invalid role {role}")
            triple = (sources[0], predicates[0], targets[0])
            if triple not in graph:
                raise KnowledgeError(f"{path}: annotated axiom is absent: {triple}")
            key = _axiom_key(graph, triple)
            structural_previous = structural_roles.get(key)
            if structural_previous and structural_previous[0] != str(role):
                raise KnowledgeError(
                    f"{path}: conflicting role for axiom; "
                    f"{structural_previous[1]} uses {structural_previous[0]}"
                )
            structural_roles[key] = (str(role), path)
            previous = assignments.get(triple)
            if previous and previous[0] != str(role):
                raise KnowledgeError(
                    f"{path}: conflicting role for {triple}; {previous[1]} uses {previous[0]}"
                )
            assignments[triple] = (str(role), path)
            local_roles[triple] = str(role)
            annotated.add(triple)
        # OWL restrictions and RDF lists are part of the annotated axiom.
        pending = list(annotated)
        while pending:
            current = pending.pop()
            target = current[2]
            if not isinstance(target, rdf.BNode):
                continue
            for nested in graph.triples((target, None, None)):
                role = local_roles[current]
                previous = assignments.get(nested)
                if previous and previous[0] != role:
                    raise KnowledgeError(
                        f"{path}: structural axiom role conflict: {nested}"
                    )
                assignments[nested] = (role, path)
                local_roles[nested] = role
                if nested not in annotated:
                    annotated.add(nested)
                    pending.append(nested)
        for triple in graph:
            if triple in annotated:
                continue
            if triple[0] in axiom_nodes:
                continue
            if triple[1] == rdf.OWL.imports:
                continue
            if triple[1] in (
                rdf.RDFS.label,
                rdf.RDFS.comment,
                rdf.URIRef("urn:shmitty:knowledge:plainTag"),
            ) or (
                triple[1] == rdf.RDF.type
                and triple[2]
                in (
                    rdf.OWL.Ontology,
                    rdf.OWL.AnnotationProperty,
                    rdf.OWL.Class,
                    rdf.RDFS.Class,
                    rdf.OWL.ObjectProperty,
                    rdf.OWL.DatatypeProperty,
                    rdf.OWL.NamedIndividual,
                    rdf.RDF.Property,
                )
            ):
                shared.add(triple)
                continue
            raise KnowledgeError(f"{path}: unannotated logical triple: {triple}")
    for triple, (role, _) in assignments.items():
        {"Shared": shared, "Requirement": requirements, "Inference": inferences}[
            role
        ].add(triple)
    return shared, shared + requirements, shared + inferences


def validate_topics(root: Path):
    """Check each topic's designated local class and parent relationship.

    The root module and each topic module must exist. ``topic_tag`` names
    exactly one class in the effective ontology, which the local module must
    declare. Nested topics require a Shared direct subclass axiom naming the
    immediate parent topic class. Invalid topics raise ``KnowledgeError``.
    This read-only operation returns ``None`` on success.
    """
    import rdflib as rdf

    from .connections import document_tags
    from .document import load_document

    root = root.resolve()
    for partition in ("sources", "tools"):
        for forbidden in (root / partition).rglob("ontology.ttl"):
            raise KnowledgeError(
                f"{forbidden}: ontology modules are forbidden in {partition}/"
            )
    topic_classes = {}
    for index in sorted(
        root.rglob("index.md"),
        key=lambda path: (len(path.relative_to(root).parts), path.as_posix()),
    ):
        directory = index.parent
        if directory == root or any(
            part in ("sources", "tools") for part in directory.relative_to(root).parts
        ):
            continue
        document = load_document(index)
        if document.metadata.get("type") != "Concept":
            continue
        tag = document.metadata.get("topic_tag")
        if not isinstance(tag, str) or tag not in document_tags(document):
            raise KnowledgeError(
                f"{index}: topic_tag must designate one of the Concept tags"
            )
        shared, _, _ = load_views(root, (index,))
        classes = {
            str(subject) for subject in shared.subjects(rdf.RDF.type, rdf.OWL.Class)
        } | {str(subject) for subject in shared.subjects(rdf.RDF.type, rdf.RDFS.Class)}
        labels = {
            str(subject)
            for subject, label in shared.subject_objects(rdf.RDFS.label)
            if str(label) == tag
        }
        matches = labels & classes
        if not matches:
            matches = {
                iri
                for iri in classes
                if iri.rsplit("#", 1)[-1].rsplit("/", 1)[-1] == tag
            }
        if len(matches) != 1:
            raise KnowledgeError(
                f"{index}: topic_tag {tag!r} must match exactly one class"
            )
        topic_class = next(iter(matches))
        local = directory / "ontology.ttl"
        if not local.is_file():
            raise KnowledgeError(f"{local}: topic ontology file is missing")
        local_graph = rdf.Graph()
        local_graph.parse(local.as_posix(), format="turtle", publicID=local.as_uri())
        if not any(
            (rdf.URIRef(topic_class), rdf.RDF.type, kind) in local_graph
            for kind in (rdf.OWL.Class, rdf.RDFS.Class)
        ):
            raise KnowledgeError(
                f"{local}: topic class {topic_class} must be declared locally"
            )
        parent = topic_classes.get(directory.parent)
        if (
            parent
            and (rdf.URIRef(topic_class), rdf.RDFS.subClassOf, rdf.URIRef(parent))
            not in shared
        ):
            raise KnowledgeError(
                f"{local}: topic class {topic_class} lacks Shared "
                f"rdfs:subClassOf parent {parent}"
            )
        topic_classes[directory] = topic_class
