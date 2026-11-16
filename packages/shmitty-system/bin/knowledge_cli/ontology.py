"""Ontology files and explicit Concept connection analysis.

Profile checks cover each authored role. The connection extractor rejects EL
expressions it cannot map to explicit Concept links.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import unquote

from .connections import document_tags, implicit_index_targets, tree_path
from .document import Document, load_document
from .errors import KnowledgeError
from .paths import markdown_targets, resolve_internal
from . import ontology_helper
from . import ontology_modules


@dataclass(frozen=True)
class TermMatch:
    concept: Path
    tag: str
    term: str
    kind: str
    match: str


@dataclass(frozen=True)
class OntologyFact:
    subject: str
    predicate: str
    object: str
    derived: bool
    link: str = ""


@dataclass(frozen=True)
class Requirement:
    concept: Path
    source_class: str
    property: str
    target_class: str
    links: Tuple[Path, ...]


@dataclass
class OntologySnapshot:
    terms: Tuple[TermMatch, ...]
    facts: Tuple[OntologyFact, ...]
    requirements: Tuple[Requirement, ...]
    qualifying_links: Dict[Path, Set[Tuple[Path, Path]]]

    def connection_counts(self, concept: Path) -> Tuple[int, int, int]:
        requirements = [
            item for item in self.requirements if item.concept == concept.resolve()
        ]
        fulfilled = sum(bool(item.links) for item in requirements)
        return (
            fulfilled,
            len(requirements) - fulfilled,
            len(self.qualifying_links.get(concept.resolve(), set())),
        )


def _rdf_modules():
    try:
        import rdflib
        import owlrl
    except ImportError as exc:
        raise KnowledgeError(
            "ontology support requires the rdflib and owlrl Python packages"
        ) from exc
    return rdflib, owlrl


def load_ontology(root: Path):
    """Read the effective role views for the root module."""
    shared, el, rl = ontology_modules.load_views(root, (root / "index.md",))
    return shared, el - shared, rl - shared


def _local_name(uri: str) -> str:
    return unquote(uri.rsplit("#", 1)[-1].rsplit("/", 1)[-1])


def _closure(edges: Dict[str, Set[str]]) -> Dict[str, Set[str]]:
    result = {node: set(parents) | {node} for node, parents in edges.items()}
    for parents in list(edges.values()):
        for parent in parents:
            result.setdefault(parent, {parent})
    changed = True
    while changed:
        changed = False
        for node, parents in result.items():
            implied = set(parents)
            for parent in list(parents):
                implied.update(result.get(parent, {parent}))
            if implied != parents:
                result[node] = implied
                changed = True
    return result


def _hierarchy(graph, predicate: str) -> Dict[str, Set[str]]:
    edges: Dict[str, Set[str]] = {}
    for subject, obj in graph.subject_objects(predicate):
        edges.setdefault(str(subject), set()).add(str(obj))
    return _closure(edges)


def _term_kinds(graph, rdf) -> Dict[str, Set[str]]:
    kinds: Dict[str, Set[str]] = {}
    for subject in graph.subjects(rdf.RDF.type, rdf.OWL.Class):
        kinds.setdefault(str(subject), set()).add("class")
    for subject in graph.subjects(rdf.RDF.type, rdf.RDFS.Class):
        kinds.setdefault(str(subject), set()).add("class")
    for role in (rdf.OWL.ObjectProperty, rdf.OWL.DatatypeProperty, rdf.RDF.Property):
        for subject in graph.subjects(rdf.RDF.type, role):
            kinds.setdefault(str(subject), set()).add("property")
    for subject in graph.subjects(rdf.RDF.type, rdf.OWL.NamedIndividual):
        kinds.setdefault(str(subject), set()).add("individual")
    for iri, roles in kinds.items():
        if len(roles) > 1:
            raise KnowledgeError(
                f"ontology term {iri} has multiple taggable kinds: "
                + ", ".join(sorted(roles))
            )
    return kinds


def _match(
    tag: str, kinds: Dict[str, Set[str]], labels: Dict[str, Set[str]], path: Path
) -> Tuple[Optional[str], str]:
    matches = [iri for iri in kinds if tag in labels.get(iri, set())]
    tier = "rdfs:label"
    if not matches:
        matches = [iri for iri in kinds if tag == _local_name(iri)]
        tier = "IRI local name"
    if len(matches) > 1:
        raise KnowledgeError(
            f"{path}: tag {tag!r} ambiguously matches {tier}: "
            + ", ".join(sorted(matches))
        )
    return (matches[0] if matches else None), tier


def tag_classification(root: Path, document: Document):
    """Classify tags in this document's effective ontology.

    Return ``(matched_terms, declared_plain, unmatched)`` as tuples of tag
    strings. Ontology terms take precedence over case-sensitive plainTag
    annotations on the effective ontology's vocabulary ontology.
    """
    rdf, _ = _rdf_modules()
    shared, _, _ = ontology_modules.load_views(root, (document.path,))
    kinds = _term_kinds(shared, rdf)
    labels: Dict[str, Set[str]] = {}
    for term, label in shared.subject_objects(rdf.RDFS.label):
        labels.setdefault(str(term), set()).add(str(label))
    plain_property = rdf.URIRef("urn:shmitty:knowledge:plainTag")
    plain = {str(value) for value in shared.objects(None, plain_property)
             if isinstance(value, rdf.Literal)}
    matched, declared_plain, unmatched = [], [], []
    for tag in document_tags(document):
        iri, _ = _match(tag, kinds, labels, document.path)
        if iri:
            matched.append(tag)
        elif tag in plain:
            declared_plain.append(tag)
        else:
            unmatched.append(tag)
    return tuple(matched), tuple(declared_plain), tuple(unmatched)


def _explicit_links(root: Path, concept: Document) -> Set[Path]:
    links = set()
    # The topic index contents serializes structural children, not authored links.
    text = concept.body
    for raw in markdown_targets(concept.body, text):
        target = resolve_internal(root, concept.path, raw)
        if target is None or not target.is_file() or target.suffix != ".md":
            continue
        if load_document(target).metadata.get("type") == "Concept":
            links.add(target.resolve())
    return links


def _term_classes(
    term: str, kinds: Dict[str, Set[str]], graph, rdf, hierarchy: Dict[str, Set[str]]
) -> Set[str]:
    classes: Set[str] = set()
    if "class" in kinds[term]:
        classes.update(hierarchy.get(term, {term}))
    if "individual" in kinds[term]:
        for klass in graph.objects(rdf.URIRef(term), rdf.RDF.type):
            if isinstance(klass, rdf.URIRef):
                classes.update(hierarchy.get(str(klass), {str(klass)}))
    return classes


def _render_expression(expression) -> str:
    if isinstance(expression, str):
        return expression
    if expression[0] == "and":
        return " and ".join(_render_expression(member) for member in expression[1])
    if expression[0] == "some":
        return "some(" + expression[1] + ", " + _render_expression(expression[2]) + ")"
    if expression[0] == "one":
        return "one(" + expression[1] + ")"
    return str(expression)


def _restriction_candidates(graph, rdf) -> List[Tuple[object, str, object]]:
    def members(head):
        output = []
        seen = set()
        while head != rdf.RDF.nil:
            if head in seen:
                raise KnowledgeError("cyclic OWL intersection list")
            seen.add(head)
            first = list(graph.objects(head, rdf.RDF.first))
            rest = list(graph.objects(head, rdf.RDF.rest))
            if len(first) != 1 or len(rest) != 1:
                raise KnowledgeError("malformed OWL intersection list")
            output.append(first[0])
            head = rest[0]
        return output

    def parse_expression(node):
        if isinstance(node, rdf.URIRef):
            return str(node)
        if not isinstance(node, rdf.BNode):
            raise KnowledgeError(f"unsupported EL class expression: {node}")
        intersections = list(graph.objects(node, rdf.OWL.intersectionOf))
        if intersections:
            if len(intersections) != 1:
                raise KnowledgeError(f"ambiguous OWL intersection: {node}")
            return (
                "and",
                tuple(
                    sorted(
                        (
                            parse_expression(member)
                            for member in members(intersections[0])
                        ),
                        key=_render_expression,
                    )
                ),
            )
        enumerations = list(graph.objects(node, rdf.OWL.oneOf))
        if enumerations:
            if len(enumerations) != 1:
                raise KnowledgeError(f"ambiguous OWL enumeration: {node}")
            values = members(enumerations[0])
            if len(values) != 1 or not isinstance(values[0], rdf.URIRef):
                raise KnowledgeError(f"unsupported OWL enumeration: {node}")
            return ("one", str(values[0]))
        properties = list(graph.objects(node, rdf.OWL.onProperty))
        fillers = list(graph.objects(node, rdf.OWL.someValuesFrom))
        values = list(graph.objects(node, rdf.OWL.hasValue))
        if (
            (node, rdf.RDF.type, rdf.OWL.Restriction) in graph
            and len(properties) == 1
            and len(values) == 1
            and isinstance(properties[0], rdf.URIRef)
            and isinstance(values[0], rdf.URIRef)
        ):
            if (properties[0], rdf.RDF.type, rdf.OWL.DatatypeProperty) in graph:
                raise KnowledgeError(f"unsupported EL data value restriction: {node}")
            return ("some", str(properties[0]), ("one", str(values[0])))
        if (
            (node, rdf.RDF.type, rdf.OWL.Restriction) in graph
            and len(properties) == 1
            and len(fillers) == 1
            and isinstance(properties[0], rdf.URIRef)
        ):
            if (properties[0], rdf.RDF.type, rdf.OWL.DatatypeProperty) in graph:
                raise KnowledgeError(f"unsupported EL data restriction: {node}")
            return ("some", str(properties[0]), parse_expression(fillers[0]))
        raise KnowledgeError(f"unsupported EL class expression: {node}")

    def extract(klass, expression):
        if isinstance(expression, rdf.URIRef):
            return []
        parsed = parse_expression(expression)
        if isinstance(parsed, tuple) and parsed[0] == "and":
            result = []
            for member in members(
                next(graph.objects(expression, rdf.OWL.intersectionOf))
            ):
                result.extend(extract(klass, member))
            return result
        if isinstance(parsed, tuple) and parsed[0] == "one":
            return []
        if not isinstance(parsed, tuple) or parsed[0] != "some":
            raise KnowledgeError(
                f"unsupported anonymous class expression: {expression}"
            )
        return [(parse_expression(klass), parsed[1], parsed[2])]

    candidates = []
    for klass, expression in graph.subject_objects(rdf.RDFS.subClassOf):
        candidates.extend(extract(klass, expression))
    for klass, expression in graph.subject_objects(rdf.OWL.equivalentClass):
        if isinstance(expression, rdf.BNode):
            candidates.extend(extract(klass, expression))
        if isinstance(klass, rdf.BNode) and isinstance(expression, rdf.URIRef):
            candidates.extend(extract(expression, klass))
    return candidates


def _normalize(
    session,
    candidates: List[Tuple[object, str, object]],
    property_supers: Dict[str, Set[str]],
    filler_cache: Dict[Tuple[object, object], bool],
) -> List[Tuple[object, str, object]]:
    def same_link_fulfills(stronger, weaker):
        if weaker[1] not in property_supers.get(stronger[1], {stronger[1]}):
            return False
        key = (stronger[2], weaker[2])
        if key not in filler_cache:
            filler_cache[key] = session.expression_subclass(*key)
        return filler_cache[key]

    retained = []
    for candidate in candidates:
        duplicate = False
        for other in candidates:
            if candidate == other:
                continue
            # Candidates already apply to the same Concept. Remove a weaker
            # requirement only if an authored link that fulfills the stronger
            # also fulfills the weaker under the link-matching rules.
            other_covers = same_link_fulfills(other, candidate)
            this_covers = same_link_fulfills(candidate, other)
            if other_covers and (not this_covers or str(other) < str(candidate)):
                duplicate = True
                break
        if not duplicate and candidate not in retained:
            retained.append(candidate)
    return retained


def _build_snapshot_scoped(root: Path, endpoints, structural_source=None) -> OntologySnapshot:
    """Analyze only the effective ontology of directly participating Concepts."""
    rdf, owlrl = _rdf_modules()
    root = root.resolve()
    selected_paths = {path.resolve() for path in endpoints}
    concepts = {}
    for path in root.rglob("*.md"):
        try:
            document = load_document(path)
        except KnowledgeError:
            continue
        if (
            document.metadata.get("type") == "Concept"
            and path.resolve() in selected_paths
        ):
            concepts[path.resolve()] = document
    vocabulary, el_graph, rl_graph = ontology_modules.load_views(
        root, concepts or (root / "index.md",)
    )
    ontology_helper.validate(root, concepts or (root / "index.md",))
    authored_rl = rl_graph.copy() if hasattr(rl_graph, "copy") else rdf.Graph()
    authored_rl += rl_graph
    kinds = _term_kinds(vocabulary, rdf)
    matches: List[TermMatch] = []
    tags_by_path: Dict[Path, Set[str]] = {}
    for path, concept in concepts.items():
        local_shared, _, _ = ontology_modules.load_views(root, (path,))
        local_kinds = _term_kinds(local_shared, rdf)
        local_labels: Dict[str, Set[str]] = {}
        for term, label in local_shared.subject_objects(rdf.RDFS.label):
            local_labels.setdefault(str(term), set()).add(str(label))
        terms = set()
        for tag in document_tags(concept):
            iri, tier = _match(tag, local_kinds, local_labels, path)
            if iri:
                terms.add(iri)
                matches.append(
                    TermMatch(path, tag, iri, ", ".join(sorted(local_kinds[iri])), tier)
                )
        tags_by_path[path] = terms
    class_edges = _hierarchy(el_graph, rdf.RDFS.subClassOf)
    for left, right in el_graph.subject_objects(rdf.OWL.equivalentClass):
        class_edges.setdefault(str(left), {str(left)}).add(str(right))
        class_edges.setdefault(str(right), {str(right)}).add(str(left))
    class_edges = _closure(class_edges)
    restrictions = _restriction_candidates(el_graph, rdf)
    assertions = rdf.Graph()
    for terms in tags_by_path.values():
        individuals = [term for term in terms if "individual" in kinds[term]]
        classes = [term for term in terms if "class" in kinds[term]]
        for individual in individuals:
            for klass in classes:
                assertions.add(
                    (rdf.URIRef(individual), rdf.RDF.type, rdf.URIRef(klass))
                )
    explicit = {
        path: _explicit_links(root, doc) & set(concepts)
        for path, doc in concepts.items()
    }
    original_rl = set(rl_graph)
    # Ontology class membership is derived before it is used to identify
    # properties between tagged individual Concepts.
    rl_graph += assertions
    owlrl.DeductiveClosure(owlrl.OWLRL_Semantics).expand(rl_graph)
    # Same-direction fulfillment can use RL-derived subproperties and class
    # memberships, including axioms authored only in axioms.ttl.
    rl_prop_edges = _hierarchy(rl_graph, rdf.RDFS.subPropertyOf)
    rl_class_edges = _hierarchy(rl_graph, rdf.RDFS.subClassOf)
    for node, parents in class_edges.items():
        rl_class_edges.setdefault(node, {node}).update(parents)
    rl_class_edges = _closure(rl_class_edges)
    with ontology_helper.EntailmentSession(
        root, concepts or (root / "index.md",)
    ) as match_session:
        authored_links: Dict[Tuple[str, str, str], Set[str]] = {}
        link_properties: Dict[Tuple[Path, Path], Set[str]] = {}
        for source, targets in explicit.items():
            for target in (
                set(concepts) - {source}
                if structural_source == source else targets
            ):
                source_terms = tags_by_path[source]
                target_terms = tags_by_path[target]
                for prop, kind in kinds.items():
                    if "property" not in kind:
                        continue
                    ancestors = rl_prop_edges.get(prop, {prop})
                    domains = set(
                        str(v)
                        for ancestor in ancestors
                        for v in authored_rl.objects(
                            rdf.URIRef(ancestor), rdf.RDFS.domain
                        )
                    )
                    ranges = set(
                        str(v)
                        for ancestor in ancestors
                        for v in authored_rl.objects(
                            rdf.URIRef(ancestor), rdf.RDFS.range
                        )
                    )
                    requirements_for_prop = [
                        (requirement_class, filler)
                        for requirement_class, requirement_prop, filler in restrictions
                        if requirement_prop in rl_prop_edges.get(prop, {prop})
                    ]
                    if not (domains and ranges) and not requirements_for_prop:
                        continue

                    def qualifies(
                        source_classes,
                        source_individuals,
                        target_classes,
                        target_individuals,
                    ):
                        domain_range = (
                            bool(domains and ranges)
                            and all(
                                match_session.all_terms_subclass(
                                    source_classes, source_individuals, domain
                                )
                                for domain in domains
                            )
                            and all(
                                match_session.all_terms_subclass(
                                    target_classes, target_individuals, range_class
                                )
                                for range_class in ranges
                            )
                        )
                        required_pair = any(
                            match_session.all_terms_subclass(
                                source_classes, source_individuals, domain
                            )
                            and match_session.all_terms_subclass(
                                target_classes, target_individuals, range_class
                            )
                            for domain, range_class in requirements_for_prop
                        )
                        return domain_range or required_pair

                    source_classes = set().union(
                        *(
                            _term_classes(v, kinds, rl_graph, rdf, rl_class_edges)
                            for v in source_terms
                        )
                    )
                    target_classes = set().union(
                        *(
                            _term_classes(v, kinds, rl_graph, rdf, rl_class_edges)
                            for v in target_terms
                        )
                    )
                    source_individuals = {
                        v for v in source_terms if "individual" in kinds[v]
                    }
                    target_individuals = {
                        v for v in target_terms if "individual" in kinds[v]
                    }
                    if not qualifies(
                        source_classes,
                        source_individuals,
                        target_classes,
                        target_individuals,
                    ):
                        continue
                    link_properties.setdefault((source, target), set()).add(prop)
                    if structural_source == source and target not in targets:
                        continue
                    for a in source_terms:
                        a_classes = _term_classes(
                            a, kinds, rl_graph, rdf, rl_class_edges
                        )
                        for b in target_terms:
                            b_classes = _term_classes(
                                b, kinds, rl_graph, rdf, rl_class_edges
                            )
                            a_individuals = {a} if "individual" in kinds[a] else set()
                            b_individuals = {b} if "individual" in kinds[b] else set()
                            if not qualifies(
                                a_classes, a_individuals, b_classes, b_individuals
                            ):
                                continue
                            triple = (rdf.URIRef(a), rdf.URIRef(prop), rdf.URIRef(b))
                            assertions.add(triple)
                            authored_links.setdefault((a, prop, b), set()).add(
                                tree_path(root, source)
                                + " -> "
                                + tree_path(root, target)
                            )
    rl_graph += assertions
    before = original_rl | set(assertions)
    owlrl.DeductiveClosure(owlrl.OWLRL_Semantics).expand(rl_graph)
    tracked_terms = set().union(*tags_by_path.values()) if tags_by_path else set()
    property_terms = {term for term, roles in kinds.items() if "property" in roles}
    facts = tuple(
        sorted(
            (
                OntologyFact(
                    str(s),
                    str(p),
                    str(o),
                    (s, p, o) not in before,
                    ", ".join(
                        sorted(authored_links.get((str(s), str(p), str(o)), set()))
                    ),
                )
                for s, p, o in rl_graph
                if str(s) in tracked_terms
                and isinstance(o, rdf.URIRef)
                and (
                    (p == rdf.RDF.type and str(o) in kinds and "class" in kinds[str(o)])
                    or (
                        str(o) in tracked_terms
                        and (str(p) in property_terms or p == rdf.OWL.sameAs)
                    )
                )
            ),
            key=lambda item: (item.subject, item.predicate, item.object),
        )
    )
    records = []
    qualifying: Dict[Path, Set[Tuple[Path, Path]]] = {}
    filler_cache: Dict[Tuple[object, object], bool] = {}
    with ontology_helper.EntailmentSession(
        root, concepts or (root / "index.md",)
    ) as session:
        for path, terms in tags_by_path.items():
            applicable = set()
            for term in terms:
                if "class" in kinds[term]:
                    applicable.update(rl_class_edges.get(term, {term}))
                if "individual" in kinds[term]:
                    for klass in rl_graph.objects(rdf.URIRef(term), rdf.RDF.type):
                        if isinstance(klass, rdf.URIRef):
                            applicable.update(
                                rl_class_edges.get(str(klass), {str(klass)})
                            )
            selected = _normalize(
                session,
                [
                    item
                    for item in restrictions
                    if session.all_terms_subclass(
                        applicable,
                        (term for term in terms if "individual" in kinds[term]),
                        item[0],
                    )
                ],
                rl_prop_edges,
                filler_cache,
            )
            for source_class, prop, target_class in selected:
                links = []
                candidate_targets = (
                    set(concepts) - {path}
                    if structural_source == path else explicit[path]
                )
                for target in candidate_targets:
                    properties = link_properties.get((path, target), set())
                    target_terms = tags_by_path[target]
                    target_classes = set().union(
                        *(
                            _term_classes(term, kinds, rl_graph, rdf, rl_class_edges)
                            for term in target_terms
                        )
                    )
                    target_individuals = (
                        term for term in target_terms if "individual" in kinds[term]
                    )
                    if session.all_terms_subclass(
                        target_classes, target_individuals, target_class
                    ) and any(prop in rl_prop_edges.get(p, {p}) for p in properties):
                        links.append(target)
                        edge = (path, target)
                        qualifying.setdefault(path, set()).add(edge)
                        if structural_source != path:
                            qualifying.setdefault(target, set()).add(edge)
                records.append(
                    Requirement(
                        path,
                        _render_expression(source_class),
                        prop,
                        _render_expression(target_class),
                        tuple(sorted(links)),
                    )
                )
    return OntologySnapshot(tuple(matches), facts, tuple(records), qualifying)


def build_snapshot(root: Path) -> OntologySnapshot:
    """Analyze each Concept and direct link under endpoint-scoped ontologies."""
    root = root.resolve()
    ontology_modules.validate_topics(root)
    concepts = {}
    for path in root.rglob("*.md"):
        try:
            document = load_document(path)
        except KnowledgeError:
            continue
        if document.metadata.get("type") == "Concept":
            concepts[path.resolve()] = document
    if not concepts:
        return _build_snapshot_scoped(root, (root / "index.md",))
    terms = set()
    fact_links = {}
    requirements = {}
    qualifying = {}
    for source, document in sorted(concepts.items()):
        targets = sorted(_explicit_links(root, document) & set(concepts))
        structural_targets = (
            sorted(set(implicit_index_targets(document)) & set(concepts))
            if document.path.name == "index.md" else []
        )
        for target in (None, *targets):
            endpoints = (source,) if target is None else (source, target)
            snapshot = _build_snapshot_scoped(root, endpoints)
            terms.update(item for item in snapshot.terms if item.concept == source)
            for fact in snapshot.facts:
                key = (fact.subject, fact.predicate, fact.object, fact.derived)
                fact_links.setdefault(key, set()).update(
                    part for part in fact.link.split(", ") if part
                )
            if target is not None:
                for path, edges in snapshot.qualifying_links.items():
                    qualifying.setdefault(path, set()).update(edges)
            for item in snapshot.requirements:
                if item.concept != source:
                    continue
                key = (
                    item.concept,
                    item.source_class,
                    item.property,
                    item.target_class,
                )
                requirements.setdefault(key, set()).update(item.links)
        for target in structural_targets:
            snapshot = _build_snapshot_scoped(
                root, (source, target), structural_source=source
            )
            for path, edges in snapshot.qualifying_links.items():
                qualifying.setdefault(path, set()).update(edges)
            for item in snapshot.requirements:
                if item.concept == source:
                    key = (item.concept, item.source_class, item.property,
                           item.target_class)
                    requirements.setdefault(key, set()).update(item.links)
    # A chain inference may use facts from intermediate authored links. Keep
    # the reasoning rules scoped to the two document endpoints being reported.
    rdf, owlrl = _rdf_modules()
    terms_by_path = {}
    for match in terms:
        terms_by_path.setdefault(match.concept, set()).add(match.term)
    for source in sorted(concepts):
        reachable = {source}
        pending = [source]
        while pending:
            current = pending.pop()
            for target in _explicit_links(root, concepts[current]) & set(concepts):
                if target not in reachable:
                    reachable.add(target)
                    pending.append(target)
        reachable_links = {
            tree_path(root, start) + " -> " + tree_path(root, end)
            for start in reachable
            for end in _explicit_links(root, concepts[start]) & reachable
        }
        authored_facts = {
            (rdf.URIRef(subject), rdf.URIRef(predicate), rdf.URIRef(object_))
            for (subject, predicate, object_, derived), links in fact_links.items()
            if not derived and links & reachable_links
        }
        for target in sorted(reachable - {source}):
            if target in _explicit_links(root, concepts[source]):
                continue
            _, _, rules = ontology_modules.load_views(root, (source, target))
            rules += authored_facts
            before = set(rules)
            owlrl.DeductiveClosure(owlrl.OWLRL_Semantics).expand(rules)
            for subject, predicate, object_ in rules:
                if (subject, predicate, object_) in before:
                    continue
                if (str(subject) not in terms_by_path.get(source, set())
                        or str(object_) not in terms_by_path.get(target, set())):
                    continue
                key = (str(subject), str(predicate), str(object_), True)
                fact_links.setdefault(key, set())
    records = tuple(
        Requirement(*key, tuple(sorted(links)))
        for key, links in sorted(requirements.items())
    )
    return OntologySnapshot(
        tuple(sorted(terms, key=lambda item: (item.concept, item.tag, item.term))),
        tuple(
            OntologyFact(*key, ", ".join(sorted(links)))
            for key, links in sorted(fact_links.items())
        ),
        records,
        qualifying,
    )


def connection_counts(root: Path, concept: Document) -> Tuple[int, int, int]:
    """Return fulfilled, open, and qualifying incident link counts."""
    return build_snapshot(root).connection_counts(concept.path)
