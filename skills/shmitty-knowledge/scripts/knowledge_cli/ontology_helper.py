"""Check OWL profiles and EL entailment with OWL API and HermiT."""

import os
import tempfile
from pathlib import Path
from typing import Iterable, Tuple

from .errors import KnowledgeError


def _classes():
    try:
        import jpype
    except ImportError as exc:
        raise KnowledgeError("ontology support requires JPype1") from exc
    jar = os.environ.get("SHMIT_OWL_JAR")
    if not jar or not Path(jar).is_file():
        raise KnowledgeError(
            "SHMIT_OWL_JAR must name the packaged HermiT OWL API JAR"
        )
    try:
        if not jpype.isJVMStarted():
            jpype.startJVM(classpath=[jar])
        return jpype.JClass
    except Exception as exc:
        raise KnowledgeError(f"cannot start OWL API: {exc}") from exc


def _ontology(paths: Tuple[Path, Path]):
    classes = _classes()
    manager = classes("org.semanticweb.owlapi.apibinding.OWLManager")\
        .createOWLOntologyManager()
    source_file = classes("java.io.File")
    try:
        import rdflib
        graph = rdflib.Graph()
        for path in paths:
            graph.parse(str(path), format="turtle", publicID=path.as_uri())
        if any(graph.triples((None, rdflib.OWL.imports, None))):
            raise KnowledgeError(
                f"{paths[0]} + {paths[1]}: owl:imports is unsupported "
                "in a self-contained knowledge tree"
            )
        if not graph:
            combined = manager.createOntology()
        else:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".ttl", encoding="utf-8"
            ) as merged:
                merged.write(graph.serialize(format="turtle"))
                merged.flush()
                combined = manager.loadOntologyFromOntologyDocument(
                    source_file(merged.name)
                )
    except KnowledgeError:
        raise
    except Exception as exc:
        raise KnowledgeError(
            f"{paths[0]} and {paths[1]}: OWL API cannot load ontology: {exc}"
        ) from exc
    return classes, manager, combined


def validate(root: Path) -> None:
    """Check the shared vocabulary in each independent ontology role."""
    for role, filename, profile_name in (
        ("EL", "requirements.ttl", "OWL2ELProfile"),
        ("RL", "axioms.ttl", "OWL2RLProfile"),
    ):
        paths = (root / "vocabulary.ttl", root / filename)
        classes, _, ontology = _ontology(paths)
        try:
            profile = classes(
                "org.semanticweb.owlapi.profiles." + profile_name
            )()
            report = profile.checkOntology(ontology)
            if not report.isInProfile():
                violations = sorted(
                    str(item) for item in report.getViolations()
                )
                raise KnowledgeError(
                    f"{paths[0]} + {paths[1]}: OWL 2 {role} profile "
                    "violation: " + "; ".join(violations)
                )
        except KnowledgeError:
            raise
        except Exception as exc:
            raise KnowledgeError(
                f"{paths[0]} + {paths[1]}: cannot check OWL 2 {role} "
                f"profile: {exc}"
            ) from exc


class EntailmentSession:
    """Reuse one EL reasoner for requirement implication and applicability."""

    def __init__(self, root: Path):
        paths = (root / "vocabulary.ttl", root / "requirements.ttl")
        self.classes, manager, ontology = _ontology(paths)
        self.factory = manager.getOWLDataFactory()
        self.iri = self.classes("org.semanticweb.owlapi.model.IRI")
        try:
            self.reasoner = self.classes(
                "org.semanticweb.HermiT.ReasonerFactory"
            )().createReasoner(ontology)
        except Exception as exc:
            raise KnowledgeError(f"cannot start EL reasoner: {exc}") from exc

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def close(self):
        self.reasoner.dispose()

    def class_expression(self, item):
        if isinstance(item, str):
            return self.factory.getOWLClass(self.iri.create(item))
        kind = item[0]
        if kind == "and":
            expressions = self.classes("java.util.HashSet")()
            for member in item[1]:
                expressions.add(self.class_expression(member))
            return self.factory.getOWLObjectIntersectionOf(expressions)
        if kind == "some":
            prop = self.factory.getOWLObjectProperty(self.iri.create(item[1]))
            return self.factory.getOWLObjectSomeValuesFrom(
                prop, self.class_expression(item[2])
            )
        if kind == "one":
            individual = self.factory.getOWLNamedIndividual(
                self.iri.create(item[1])
            )
            return self.factory.getOWLObjectOneOf(individual)
        raise KnowledgeError(f"unsupported EL expression: {item}")

    def entails(self, left: Tuple[str, str, object],
                right: Tuple[str, str, object]) -> bool:
        def expression(item):
            _, property_iri, filler = item
            return self.class_expression(("some", property_iri, filler))

        try:
            axiom = self.factory.getOWLSubClassOfAxiom(
                expression(left), expression(right)
            )
            return bool(self.reasoner.isEntailed(axiom))
        except Exception as exc:
            raise KnowledgeError(
                f"EL subsumption check failed: {exc}"
            ) from exc

    def subclass(self, child_iri: str, parent_iri: str) -> bool:
        try:
            child = self.factory.getOWLClass(self.iri.create(child_iri))
            parent = self.factory.getOWLClass(self.iri.create(parent_iri))
            return bool(self.reasoner.isEntailed(
                self.factory.getOWLSubClassOfAxiom(child, parent)
            ))
        except Exception as exc:
            raise KnowledgeError(
                f"EL class subsumption check failed: {exc}"
            ) from exc

    def all_classes_subclass(self, child_iris: Iterable[str],
                             parent_expr) -> bool:
        """Test whether known classes imply a class expression."""
        names = sorted(set(child_iris))
        if not names:
            return False
        try:
            intersection = self.class_expression(("and", tuple(names)))
            parent = self.class_expression(parent_expr)
            return bool(self.reasoner.isEntailed(
                self.factory.getOWLSubClassOfAxiom(intersection, parent)
            ))
        except Exception as exc:
            raise KnowledgeError(
                f"EL class conjunction check failed: {exc}"
            ) from exc

    def all_terms_subclass(self, child_iris: Iterable[str],
                           individual_iris: Iterable[str],
                           parent_expr) -> bool:
        """Test classes and matched individual identities against a filler."""
        names = sorted(set(child_iris))
        if names and self.all_classes_subclass(names, parent_expr):
            return True
        try:
            parent = self.class_expression(parent_expr)
            for individual_iri in sorted(set(individual_iris)):
                parts = tuple(names) + (("one", individual_iri),)
                child = self.class_expression(("and", parts))
                if self.reasoner.isEntailed(
                    self.factory.getOWLSubClassOfAxiom(child, parent)
                ):
                    return True
            return False
        except Exception as exc:
            raise KnowledgeError(
                f"EL individual qualification failed: {exc}"
            ) from exc


def entails(root: Path, left: Tuple[str, str, str],
            right: Tuple[str, str, str]) -> bool:
    """Test whether one existential restriction implies another."""
    with EntailmentSession(root) as session:
        return session.entails(left, right)


def subclass(root: Path, child_iri: str, parent_iri: str) -> bool:
    """Test named-class subsumption in the EL role ontology."""
    with EntailmentSession(root) as session:
        return session.subclass(child_iri, parent_iri)
