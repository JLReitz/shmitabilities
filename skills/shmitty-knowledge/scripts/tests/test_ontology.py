"""Focused ontology behavior at the authored tag and link boundary."""

from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import unittest
from shutil import copyfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_cli.errors import KnowledgeError
from knowledge_cli.ontology import build_snapshot, load_ontology


VOCABULARY = """\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Rover a owl:Class ; rdfs:label "Rover" .
ex:Sensor a owl:Class .
ex:uses a owl:ObjectProperty ; rdfs:domain ex:Rover ;
    rdfs:range ex:Sensor .
ex:specialUses a owl:ObjectProperty ; rdfs:subPropertyOf ex:uses ;
    rdfs:domain ex:Rover ; rdfs:range ex:Sensor .
"""
REQUIREMENTS = """\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Rover rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:uses ;
    owl:someValuesFrom ex:Sensor ] .
"""


def concept(path: Path, tags, body=""):
    path.write_text("---\ntype: Concept\ntitle: Example\n"
                    + "tags: [" + ", ".join(tags) + "]\n---\n"
                    + body, encoding="utf-8")


class OntologyTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / "vocabulary.ttl").write_text(VOCABULARY)
        (self.root / "requirements.ttl").write_text(REQUIREMENTS)
        (self.root / "axioms.ttl").write_text("")

    def tearDown(self):
        self.directory.cleanup()

    def test_required_files(self):
        (self.root / "axioms.ttl").unlink()
        with self.assertRaisesRegex(KnowledgeError, "required ontology file"):
            load_ontology(self.root)

    def test_anonymous_el_requirement_source_applies(self):
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
[ owl:intersectionOf (ex:Rover ex:Sensor) ]
    rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:uses ;
    owl:someValuesFrom ex:Sensor ] .
''')
        concept(self.root / "both.md", ["Rover", "Sensor"],
                "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "both.md"),
                         (1, 0, 1))

    def test_nested_el_filler_qualifies_target_class(self):
        (self.root / "vocabulary.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class .
ex:p a owl:ObjectProperty . ex:q a owl:ObjectProperty .
''')
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:p ;
    owl:someValuesFrom [ a owl:Restriction ; owl:onProperty ex:q ;
        owl:someValuesFrom ex:C ] ] .
ex:B rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:q ;
    owl:someValuesFrom ex:C ] .
''')
        concept(self.root / "a.md", ["A"], "[B](b.md)\n")
        concept(self.root / "b.md", ["B"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "a.md"),
                         (1, 0, 1))

    def test_el_has_value_uses_individual_tag_at_target(self):
        (self.root / "vocabulary.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:A a owl:Class . ex:Target a owl:NamedIndividual .
ex:p a owl:ObjectProperty .
''')
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:p ;
    owl:hasValue ex:Target ] .
''')
        concept(self.root / "a.md", ["A"], "[target](target.md)\n")
        concept(self.root / "target.md", ["Target"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "a.md"),
                         (1, 0, 1))

    def test_data_existence_reports_unsupported_connection_model(self):
        (self.root / "vocabulary.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:A a owl:Class . ex:hasValue a owl:DatatypeProperty .
''')
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
ex:A rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:hasValue ; owl:someValuesFrom xsd:string ] .
''')
        concept(self.root / "a.md", ["A"])
        with self.assertRaisesRegex(
            KnowledgeError, "unsupported EL data restriction"
        ):
            build_snapshot(self.root)

    def test_directional_requirement_and_incident_link(self):
        rover = self.root / "rover.md"
        sensor = self.root / "sensor.md"
        concept(rover, ["Rover"], "[sensor](sensor.md)\n")
        concept(sensor, ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (1, 0, 1))
        self.assertTrue(any(
            fact.link and fact.predicate.endswith("specialUses")
            for fact in snapshot.facts
        ))
        self.assertEqual(snapshot.connection_counts(sensor), (0, 0, 1))
        self.assertEqual(len([f for f in snapshot.facts if f.link
                              and f.predicate.endswith("uses")]), 1)
        concept(rover, ["Rover"])
        concept(sensor, ["Sensor"], "[rover](rover.md)\n")
        reversed_snapshot = build_snapshot(self.root)
        self.assertEqual(reversed_snapshot.connection_counts(rover),
                         (0, 1, 0))

    def test_ambiguity_at_label_tier(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('ex:Another a owl:Class ; rdfs:label "Rover" .\n')
        concept(self.root / "rover.md", ["Rover"])
        with self.assertRaisesRegex(KnowledgeError,
                                    "ambiguously matches rdfs:label"):
            build_snapshot(self.root)

    def test_label_precedes_local_name_and_subproperty_fulfills(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('ex:Other a owl:Class ; rdfs:label "Sensor" .\n')
            output.write('ex:Sensor rdfs:label "Detector" .\n')
        rover = self.root / "rover.md"
        target = self.root / "target.md"
        concept(rover, ["Rover"], "[target](target.md)\n")
        concept(target, ["Sensor"])
        snapshot = build_snapshot(self.root)
        matches = [term for term in snapshot.terms if term.concept == target]
        self.assertEqual(matches[0].term, "https://example.org/Other")
        self.assertEqual(matches[0].match, "rdfs:label")
        self.assertEqual(snapshot.connection_counts(rover), (0, 1, 0))
        concept(target, ["Detector"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (1, 0, 1))

    def test_topic_contents_link_fulfills_and_asserts_property(self):
        folder = self.root / "Rover"
        folder.mkdir()
        concept(folder / "index.md", ["Rover"],
                "Topic.\n\n---\n\n# Contents\n\n"
                "- [sensor](sensor.md)\n")
        concept(folder / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(folder / "index.md"),
                         (1, 0, 1))
        self.assertTrue(any(
            fact.subject == "https://example.org/Rover"
            and fact.predicate == "https://example.org/uses"
            and fact.object == "https://example.org/Sensor"
            and not fact.derived
            for fact in snapshot.facts
        ))

    def test_topic_abstract_and_contents_both_supply_links(self):
        folder = self.root / "Rover"
        folder.mkdir()
        concept(folder / "index.md", ["Rover"],
                "See [outside](../outside.md).\n\n---\n\n"
                "# Contents\n\n- [inside](sensor.md)\n")
        concept(self.root / "outside.md", ["Sensor"])
        concept(folder / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(folder / "index.md"),
                         (1, 0, 2))
        self.assertEqual(len(next(
            item.links for item in snapshot.requirements
            if item.concept == (folder / "index.md").resolve()
        )), 2)

    def test_individual_cotags_assert_membership_and_link(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('ex:Aster a owl:NamedIndividual .\n')
            output.write('ex:Camera a owl:NamedIndividual ; a ex:Sensor .\n')
        rover = self.root / "rover.md"
        sensor = self.root / "sensor.md"
        concept(rover, ["Aster", "Rover"], "[Camera](sensor.md)\n")
        concept(sensor, ["Camera"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (1, 0, 1))
        self.assertTrue(any(
            fact.subject.endswith("Aster")
            and fact.predicate.endswith("uses")
            and fact.object.endswith("Camera")
            for fact in snapshot.facts
        ))

    def test_rl_inferred_individual_membership_selects_requirement(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('ex:Aster a owl:NamedIndividual .\n')
            output.write('ex:Vehicle a owl:Class .\n')
        (self.root / "axioms.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Aster a ex:Vehicle .
ex:Vehicle rdfs:subClassOf ex:Rover .
''')
        concept(self.root / "aster.md", ["Aster"],
                "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "aster.md"),
                         (1, 0, 1))

    def test_independent_requirements_share_one_link(self):
        # A domain axiom could make one existential imply both Rover rules.
        vocabulary = (self.root / "vocabulary.ttl").read_text()
        vocabulary = vocabulary.replace(
            "ex:uses a owl:ObjectProperty ; rdfs:domain ex:Rover ;",
            "ex:uses a owl:ObjectProperty ;")
        (self.root / "vocabulary.ttl").write_text(vocabulary)
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('ex:observes a owl:ObjectProperty .\n')
        with (self.root / "requirements.ttl").open("a") as output:
            output.write('''\
ex:Rover rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:observes ; owl:someValuesFrom ex:Sensor ] .
''')
        concept(self.root / "rover.md", ["Rover"],
                "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "rover.md"),
                         (2, 0, 1))

    def test_inverse_fact_does_not_fulfill_reverse_requirement(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('ex:usedBy a owl:ObjectProperty .\n')
        (self.root / "axioms.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:uses owl:inverseOf ex:usedBy .
''')
        concept(self.root / "rover.md", ["Rover"])
        concept(self.root / "sensor.md", ["Sensor"],
                "[rover](rover.md)\n")
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "rover.md"),
                         (0, 1, 0))

    def test_stronger_requirement_removes_weaker_one(self):
        with (self.root / "requirements.ttl").open("a") as output:
            output.write('''\
ex:Rover rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:specialUses ; owl:someValuesFrom ex:Sensor ] .
''')
        rover = self.root / "rover.md"
        concept(rover, ["Rover"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (0, 1, 0))
        self.assertTrue(snapshot.requirements[0].property.endswith(
            "specialUses"))

    def test_property_domain_does_not_remove_other_link_requirement(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('''\
ex:Terrain a owl:Class .
ex:explores a owl:ObjectProperty ; rdfs:domain ex:Rover ;
    rdfs:range ex:Terrain .
''')
        with (self.root / "requirements.ttl").open("a") as output:
            output.write('''\
ex:Rover rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:explores ; owl:someValuesFrom ex:Terrain ] .
''')
        rover = self.root / "rover.md"
        concept(rover, ["Rover"], "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        concept(self.root / "terrain.md", ["Terrain"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (1, 1, 1))
        self.assertEqual({item.property.rsplit("/", 1)[-1]
                          for item in snapshot.requirements},
                         {"uses", "explores"})
        concept(rover, ["Rover"],
                "[sensor](sensor.md)\n[terrain](terrain.md)\n")
        self.assertEqual(build_snapshot(self.root).connection_counts(rover),
                         (2, 0, 2))

    def test_narrower_filler_removes_broader_filler_requirement(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('''\
ex:Device a owl:Class .
ex:Sensor rdfs:subClassOf ex:Device .
''')
        with (self.root / "requirements.ttl").open("a") as output:
            output.write('''\
ex:Rover rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:uses ; owl:someValuesFrom ex:Device ] .
''')
        rover = self.root / "rover.md"
        concept(rover, ["Rover"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (0, 1, 0))
        self.assertEqual(snapshot.requirements[0].target_class,
                         "https://example.org/Sensor")

    def test_el_only_subproperty_does_not_remove_rl_link_obligation(self):
        vocabulary = (self.root / "vocabulary.ttl").read_text()
        vocabulary = vocabulary.replace(
            "ex:specialUses a owl:ObjectProperty ; "
            "rdfs:subPropertyOf ex:uses ;",
            "ex:specialUses a owl:ObjectProperty ;")
        (self.root / "vocabulary.ttl").write_text(vocabulary)
        with (self.root / "requirements.ttl").open("a") as output:
            output.write('''\
ex:specialUses rdfs:subPropertyOf ex:uses .
ex:Rover rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:specialUses ; owl:someValuesFrom ex:Sensor ] .
''')
        rover = self.root / "rover.md"
        concept(rover, ["Rover"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (0, 2, 0))

    def test_rl_only_subproperty_removes_weaker_link_obligation(self):
        vocabulary = (self.root / "vocabulary.ttl").read_text()
        vocabulary = vocabulary.replace(
            "ex:specialUses a owl:ObjectProperty ; "
            "rdfs:subPropertyOf ex:uses ;",
            "ex:specialUses a owl:ObjectProperty ;")
        (self.root / "vocabulary.ttl").write_text(vocabulary)
        (self.root / "axioms.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:specialUses rdfs:subPropertyOf ex:uses .
''')
        with (self.root / "requirements.ttl").open("a") as output:
            output.write('''\
ex:Rover rdfs:subClassOf [ a owl:Restriction ;
    owl:onProperty ex:specialUses ; owl:someValuesFrom ex:Sensor ] .
''')
        rover = self.root / "rover.md"
        concept(rover, ["Rover"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(rover), (0, 1, 0))
        self.assertTrue(snapshot.requirements[0].property.endswith(
            "specialUses"))

    def test_requirement_patterns_do_not_cross_pair_endpoints(self):
        (self.root / "vocabulary.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:A a owl:Class . ex:B a owl:Class .
ex:C a owl:Class . ex:D a owl:Class .
ex:uses a owl:ObjectProperty .
''')
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:uses ;
    owl:someValuesFrom ex:B ] .
ex:C rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:uses ;
    owl:someValuesFrom ex:D ] .
''')
        concept(self.root / "a.md", ["A"], "[D](d.md)\n")
        concept(self.root / "d.md", ["D"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "a.md"),
                         (0, 1, 0))
        self.assertFalse(any(fact.link for fact in snapshot.facts))

    def test_multiple_properties_and_duplicate_triples_keep_provenance(self):
        with (self.root / "vocabulary.ttl").open("a") as output:
            output.write('''\
ex:observes a owl:ObjectProperty ; rdfs:domain ex:Rover ;
    rdfs:range ex:Sensor .
''')
        concept(self.root / "rover-one.md", ["Rover"],
                "[sensor](sensor.md)\n")
        concept(self.root / "rover-two.md", ["Rover"],
                "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        for property_name in ("uses", "observes"):
            facts = [fact for fact in snapshot.facts
                     if fact.subject.endswith("Rover")
                     and fact.predicate.endswith(property_name)
                     and fact.object.endswith("Sensor")]
            self.assertEqual(len(facts), 1)
            self.assertIn("/rover-one.md -> /sensor.md", facts[0].link)
            self.assertIn("/rover-two.md -> /sensor.md", facts[0].link)

    def test_rl_only_subproperty_fulfills_authored_direction(self):
        with (self.root / "axioms.ttl").open("a") as output:
            output.write('''\
@prefix ex: <https://example.org/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:specialUses rdfs:subPropertyOf ex:uses .
''')
        # The vocabulary already declares the same subproperty; remove that
        # declaration to prove the RL role alone is sufficient.
        vocabulary = (self.root / "vocabulary.ttl").read_text()
        vocabulary = vocabulary.replace(
            "ex:specialUses a owl:ObjectProperty ; "
            "rdfs:subPropertyOf ex:uses ;",
            "ex:specialUses a owl:ObjectProperty ;")
        (self.root / "vocabulary.ttl").write_text(vocabulary)
        concept(self.root / "rover.md", ["Rover"],
                "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "rover.md"),
                         (1, 0, 1))

    def test_el_conjunction_classifies_link_endpoint(self):
        (self.root / "vocabulary.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A a owl:Class ; owl:equivalentClass [ owl:intersectionOf (ex:B ex:C) ] .
ex:B a owl:Class . ex:C a owl:Class .
ex:D a owl:Class ; rdfs:subClassOf ex:B, ex:C .
ex:Sensor a owl:Class .
ex:uses a owl:ObjectProperty ; rdfs:domain ex:A ; rdfs:range ex:Sensor .
''')
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:uses ;
    owl:someValuesFrom ex:Sensor ] .
''')
        concept(self.root / "d.md", ["D"], "[sensor](sensor.md)\n")
        concept(self.root / "sensor.md", ["Sensor"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "d.md"),
                         (1, 0, 1))

    def test_rl_property_chain_is_reported_without_fulfilling_link(self):
        (self.root / "vocabulary.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A a owl:Class . ex:B a owl:Class . ex:C a owl:Class .
ex:p a owl:ObjectProperty ; rdfs:domain ex:A ; rdfs:range ex:B .
ex:q a owl:ObjectProperty ; rdfs:domain ex:B ; rdfs:range ex:C .
ex:r a owl:ObjectProperty ; rdfs:domain ex:A ; rdfs:range ex:C .
''')
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:r ;
    owl:someValuesFrom ex:C ] .
''')
        (self.root / "axioms.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:r owl:propertyChainAxiom (ex:p ex:q) .
''')
        concept(self.root / "a.md", ["A"], "[B](b.md)\n")
        concept(self.root / "b.md", ["B"], "[C](c.md)\n")
        concept(self.root / "c.md", ["C"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "a.md"),
                         (0, 1, 0))
        self.assertTrue(any(
            fact.subject.endswith("A") and fact.predicate.endswith("r")
            and fact.object.endswith("C") and fact.derived
            for fact in snapshot.facts
        ))

    def test_intersection_of_requirements_is_extracted(self):
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Rover rdfs:subClassOf [ a owl:Class ; owl:intersectionOf (
    [ a owl:Restriction ; owl:onProperty ex:uses ;
      owl:someValuesFrom ex:Sensor ]
    [ a owl:Restriction ; owl:onProperty ex:specialUses ;
      owl:someValuesFrom ex:Sensor ]
) ] .
''')
        concept(self.root / "rover.md", ["Rover"])
        snapshot = build_snapshot(self.root)
        self.assertEqual(snapshot.connection_counts(self.root / "rover.md"),
                         (0, 1, 0))


class PublishedSosaTests(unittest.TestCase):
    def test_real_sosa_rl_and_companion_el_requirement(self):
        fixture = Path(__file__).parent / "fixtures" / "sosa"
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("vocabulary.ttl", "requirements.ttl", "axioms.ttl"):
                copyfile(fixture / name, root / name)
            concept(root / "sensor.md", ["Sensor"],
                    "[observation](observation.md)\n")
            concept(root / "observation.md", ["Observation"])
            snapshot = build_snapshot(root)
            self.assertEqual(snapshot.connection_counts(root / "sensor.md"),
                             (1, 0, 1))
            self.assertTrue(any(
                fact.predicate.endswith("madeBySensor") and fact.derived
                for fact in snapshot.facts
            ))


if __name__ == "__main__":
    unittest.main()
