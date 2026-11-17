"""Focused tests for effective ontology modules and axiom roles."""

from pathlib import Path
from tempfile import TemporaryDirectory
import os
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))

from knowledge_cli.errors import KnowledgeError
from knowledge_cli.ontology import build_snapshot
from knowledge_cli.ontology_modules import (
    load_views,
    module_paths,
    validate_topics,
)


PREFIXES = """\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sk: <urn:shmitty:knowledge:> .
"""


def axiom(subject, predicate, target, role):
    return (
        f"{subject} {predicate} {target} .\n"
        "[] a owl:Axiom ; "
        f"owl:annotatedSource {subject} ; "
        f"owl:annotatedProperty {predicate} ; "
        f"owl:annotatedTarget {target} ; "
        f'sk:role "{role}" .\n'
    )


class OntologyModuleTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "ontology.ttl").write_text(PREFIXES, encoding="utf-8")

    def test_module_paths_include_root_and_topic_ancestors_only(self):
        topic = self.root / "alpha"
        nested = topic / "beta"
        sibling = self.root / "gamma"
        nested.mkdir(parents=True)
        sibling.mkdir()
        for directory in (topic, nested, sibling):
            (directory / "ontology.ttl").write_text(PREFIXES, encoding="utf-8")

        actual = list(module_paths(self.root, nested / "concept.md"))

        self.assertEqual(
            actual,
            [
                self.root / "ontology.ttl",
                topic / "ontology.ttl",
                nested / "ontology.ttl",
            ],
        )

    def test_roles_partition_independent_el_and_rl_views(self):
        (self.root / "ontology.ttl").write_text(
            PREFIXES
            + axiom("ex:A", "rdf:type", "owl:Class", "Shared")
            + axiom("ex:A", "rdfs:subClassOf", "ex:B", "Requirement")
            + axiom("ex:B", "rdfs:subClassOf", "ex:C", "Inference"),
            encoding="utf-8",
        )

        shared, el, rl = load_views(self.root, [self.root / "index.md"])

        from rdflib import OWL, RDF, RDFS, URIRef

        a = URIRef("https://example.org/A")
        b = URIRef("https://example.org/B")
        c = URIRef("https://example.org/C")
        self.assertIn((a, RDF.type, OWL.Class), shared)
        self.assertIn((a, RDFS.subClassOf, b), el)
        self.assertNotIn((a, RDFS.subClassOf, b), rl)
        self.assertIn((b, RDFS.subClassOf, c), rl)
        self.assertNotIn((b, RDFS.subClassOf, c), el)

    def test_conflicting_repeated_role_is_error(self):
        topic = self.root / "alpha"
        topic.mkdir()
        (self.root / "ontology.ttl").write_text(
            PREFIXES + axiom("ex:A", "rdf:type", "owl:Class", "Shared"),
            encoding="utf-8",
        )
        (topic / "ontology.ttl").write_text(
            PREFIXES + axiom("ex:A", "rdf:type", "owl:Class", "Inference"),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(KnowledgeError, "conflicting role"):
            load_views(self.root, [topic / "index.md"])

    def test_repeated_shared_axiom_is_accepted(self):
        topic = self.root / "alpha"
        topic.mkdir()
        declaration = axiom("ex:A", "rdf:type", "owl:Class", "Shared")
        (self.root / "ontology.ttl").write_text(
            PREFIXES + declaration, encoding="utf-8"
        )
        (topic / "ontology.ttl").write_text(PREFIXES + declaration, encoding="utf-8")

        shared, _, _ = load_views(self.root, [topic / "index.md"])

        from rdflib import OWL, RDF, URIRef

        self.assertIn((URIRef("https://example.org/A"), RDF.type, OWL.Class), shared)

    def test_blank_node_axiom_role_conflict_is_error(self):
        topic = self.root / "alpha"
        topic.mkdir()
        statement = (
            "ex:A rdfs:subClassOf [ a owl:Restriction ; "
            "owl:onProperty ex:p ; owl:someValuesFrom ex:B ] .\n"
            "[] a owl:Axiom ; owl:annotatedSource ex:A ; "
            "owl:annotatedProperty rdfs:subClassOf ; "
            "owl:annotatedTarget [ a owl:Restriction ; "
            "owl:onProperty ex:p ; owl:someValuesFrom ex:B ] ; "
            'sk:role "Shared" .\n'
        )
        # The annotation target must be the same blank node as the axiom
        # object, so use a named Turtle blank-node label in both positions.
        statement = (
            statement.replace(
                "[ a owl:Restriction ; owl:onProperty ex:p ; owl:someValuesFrom ex:B ]",
                "_:restriction",
            )
            + "_:restriction a owl:Restriction ; owl:onProperty ex:p ; "
            "owl:someValuesFrom ex:B .\n"
        )
        (self.root / "ontology.ttl").write_text(PREFIXES + statement, encoding="utf-8")
        (topic / "ontology.ttl").write_text(
            PREFIXES + statement.replace('sk:role "Shared"', 'sk:role "Inference"'),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(KnowledgeError, "conflicting role"):
            load_views(self.root, [topic / "index.md"])

    def test_unannotated_logical_triple_is_error(self):
        (self.root / "ontology.ttl").write_text(
            PREFIXES + "ex:A rdfs:subClassOf ex:B .\n", encoding="utf-8"
        )

        with self.assertRaisesRegex(KnowledgeError, "unannotated logical"):
            load_views(self.root, [self.root / "index.md"])

    def test_unannotated_entity_declarations_are_shared(self):
        (self.root / "ontology.ttl").write_text(
            PREFIXES + "ex:A a owl:Class .\nex:p a owl:ObjectProperty .\n",
            encoding="utf-8",
        )

        shared, el, rl = load_views(self.root, [self.root / "index.md"])

        from rdflib import OWL, RDF, URIRef

        declaration = (URIRef("https://example.org/A"), RDF.type, OWL.Class)
        self.assertIn(declaration, shared)
        self.assertIn(declaration, el)
        self.assertIn(declaration, rl)

    def test_import_is_error(self):
        (self.root / "ontology.ttl").write_text(
            PREFIXES + "<> owl:imports <https://example.org/other> .\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(KnowledgeError, "owl:imports"):
            load_views(self.root, [self.root / "index.md"])

    def test_identical_property_domain_and_range_is_error(self):
        (self.root / "ontology.ttl").write_text(
            PREFIXES
            + "ex:A a owl:Class . ex:B a owl:Class .\n"
            + "ex:first a owl:ObjectProperty .\n"
            + "ex:second a owl:ObjectProperty .\n"
            + axiom("ex:first", "rdfs:domain", "ex:A", "Shared")
            + axiom("ex:first", "rdfs:range", "ex:B", "Shared")
            + axiom("ex:second", "rdfs:domain", "ex:A", "Shared")
            + axiom("ex:second", "rdfs:range", "ex:B", "Shared"),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(
            KnowledgeError,
            "first.*second.*identical domain and range",
        ):
            build_snapshot(self.root)

    def test_nested_topic_class_has_shared_parent(self):
        parent = self.root / "parent"
        child = parent / "child"
        child.mkdir(parents=True)
        (parent / "index.md").write_text(
            "---\ntype: Concept\ntags: [Parent]\ntopic_tag: Parent\n---\n"
            "Parent topic.\n",
            encoding="utf-8",
        )
        (child / "index.md").write_text(
            "---\ntype: Concept\ntags: [Child]\ntopic_tag: Child\n---\nChild topic.\n",
            encoding="utf-8",
        )
        (parent / "ontology.ttl").write_text(
            PREFIXES + axiom("ex:Parent", "rdf:type", "owl:Class", "Shared"),
            encoding="utf-8",
        )
        (child / "ontology.ttl").write_text(
            PREFIXES
            + axiom("ex:Child", "rdf:type", "owl:Class", "Shared")
            + axiom("ex:Child", "rdfs:subClassOf", "ex:Parent", "Shared"),
            encoding="utf-8",
        )

        validate_topics(self.root)

        (child / "ontology.ttl").write_text(
            PREFIXES + axiom("ex:Child", "rdf:type", "owl:Class", "Shared"),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(KnowledgeError, "lacks Shared"):
            validate_topics(self.root)

    def test_topic_tag_must_name_local_class(self):
        topic = self.root / "topic"
        topic.mkdir()
        (topic / "index.md").write_text(
            "---\ntype: Concept\ntags: [Unrelated]\ntopic_tag: Missing\n---\nTopic.\n",
            encoding="utf-8",
        )
        (topic / "ontology.ttl").write_text(PREFIXES, encoding="utf-8")

        with self.assertRaisesRegex(KnowledgeError, "topic_tag"):
            validate_topics(self.root)

    def test_sibling_module_does_not_match_unrelated_concept(self):
        if not os.environ.get("SHMIT_OWL_JAR"):
            self.skipTest("packaged HermiT JAR is not configured")
        left = self.root / "left"
        right = self.root / "right"
        left.mkdir()
        right.mkdir()
        for directory, name in ((left, "Left"), (right, "Right")):
            (directory / "index.md").write_text(
                f"---\ntype: Concept\ntags: [{name}]\n"
                f"topic_tag: {name}\n---\n{name} topic.\n",
                encoding="utf-8",
            )
            (directory / "ontology.ttl").write_text(
                PREFIXES + axiom(f"ex:{name}", "rdf:type", "owl:Class", "Shared"),
                encoding="utf-8",
            )
        (left / "concept.md").write_text(
            "---\ntype: Concept\ntags: [Right]\n---\n"
            "[Related topic](../right/index.md)\n",
            encoding="utf-8",
        )

        snapshot = build_snapshot(self.root)

        self.assertFalse(
            any(item.concept == left / "concept.md" for item in snapshot.terms)
        )

    def test_intermediate_links_do_not_import_sibling_inference_axioms(self):
        if not os.environ.get("SHMIT_OWL_JAR"):
            self.skipTest("packaged HermiT JAR is not configured")
        (self.root / "ontology.ttl").write_text(
            PREFIXES
            + """ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class .
ex:p a owl:ObjectProperty . ex:q a owl:ObjectProperty .
ex:r a owl:ObjectProperty .
"""
            + axiom("ex:p", "rdfs:domain", "ex:A", "Shared")
            + axiom("ex:p", "rdfs:range", "ex:B", "Shared")
            + axiom("ex:q", "rdfs:domain", "ex:B", "Shared")
            + axiom("ex:q", "rdfs:range", "ex:C", "Shared")
            + axiom("ex:r", "rdfs:domain", "ex:A", "Shared")
            + axiom("ex:r", "rdfs:range", "ex:C", "Shared"),
            encoding="utf-8",
        )
        for name, body in (("a", "[B](b.md)"), ("b", "[C](c.md)"), ("c", "C")):
            (self.root / f"{name}.md").write_text(
                f"---\ntype: Concept\ntags: [{name.upper()}]\n---\n{body}\n",
                encoding="utf-8",
            )
        sibling = self.root / "sibling"
        sibling.mkdir()
        (sibling / "index.md").write_text(
            "---\ntype: Concept\ntags: [Sibling]\ntopic_tag: Sibling\n---\nSibling.\n",
            encoding="utf-8",
        )
        (sibling / "ontology.ttl").write_text(
            PREFIXES
            + "ex:Sibling a owl:Class .\n"
            + "ex:r owl:propertyChainAxiom _:chain .\n"
            + "_:chain rdf:first ex:p ; rdf:rest _:tail .\n"
            + "_:tail rdf:first ex:q ; rdf:rest rdf:nil .\n"
            + "[] a owl:Axiom ; owl:annotatedSource ex:r ; "
            + "owl:annotatedProperty owl:propertyChainAxiom ; "
            + 'owl:annotatedTarget _:chain ; sk:role "Inference" .\n',
            encoding="utf-8",
        )

        snapshot = build_snapshot(self.root)

        self.assertFalse(any(
            fact.subject.endswith("/A") and fact.predicate.endswith("/r")
            and fact.object.endswith("/C") for fact in snapshot.facts
        ))

    def test_chain_does_not_use_unrelated_authored_fact(self):
        if not os.environ.get("SHMIT_OWL_JAR"):
            self.skipTest("packaged HermiT JAR is not configured")
        (self.root / "ontology.ttl").write_text(
            PREFIXES
            + "ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class .\n"
            + "ex:p a owl:ObjectProperty . ex:q a owl:ObjectProperty . "
            + "ex:r a owl:ObjectProperty .\n"
            + axiom("ex:p", "rdfs:domain", "ex:A", "Shared")
            + axiom("ex:p", "rdfs:range", "ex:B", "Shared")
            + "ex:r owl:propertyChainAxiom _:chain .\n"
            + "_:chain rdf:first ex:p ; rdf:rest _:tail .\n"
            + "_:tail rdf:first ex:q ; rdf:rest rdf:nil .\n"
            + "[] a owl:Axiom ; owl:annotatedSource ex:r ; "
            + "owl:annotatedProperty owl:propertyChainAxiom ; "
            + 'owl:annotatedTarget _:chain ; sk:role "Inference" .\n',
            encoding="utf-8",
        )
        for name, tag, body in (
            ("a", "A", "[B](b.md)"), ("b", "B", "[C](c.md)"),
            ("c", "C", "C"),
        ):
            (self.root / f"{name}.md").write_text(
                f"---\ntype: Concept\ntags: [{tag}]\n---\n{body}\n",
                encoding="utf-8",
            )
        sibling = self.root / "sibling"
        sibling.mkdir()
        (sibling / "index.md").write_text(
            "---\ntype: Concept\ntags: [Sibling]\ntopic_tag: Sibling\n---\nSibling.\n",
            encoding="utf-8",
        )
        (sibling / "ontology.ttl").write_text(
            PREFIXES + "ex:Sibling a owl:Class .\n"
            + axiom("ex:q", "rdfs:domain", "ex:B", "Shared")
            + axiom("ex:q", "rdfs:range", "ex:C", "Shared"),
            encoding="utf-8",
        )
        (sibling / "b.md").write_text(
            "---\ntype: Concept\ntags: [B]\n---\n[C](c.md)\n",
            encoding="utf-8",
        )
        (sibling / "c.md").write_text(
            "---\ntype: Concept\ntags: [C]\n---\nC\n",
            encoding="utf-8",
        )

        snapshot = build_snapshot(self.root)

        self.assertFalse(any(
            fact.subject.endswith("/A") and fact.predicate.endswith("/r")
            and fact.object.endswith("/C") for fact in snapshot.facts
        ))


if __name__ == "__main__":
    unittest.main()
