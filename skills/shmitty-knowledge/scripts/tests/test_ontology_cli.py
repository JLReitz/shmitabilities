"""End-to-end ontology reports and connection investment."""

import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_cli.commands import main


VOCABULARY = """\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Rover a owl:Class .
ex:Sensor a owl:Class .
ex:uses a owl:ObjectProperty ; rdfs:domain ex:Rover ; rdfs:range ex:Sensor .
"""
REQUIREMENTS = """\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:Rover rdfs:subClassOf [ a owl:Restriction ; owl:onProperty ex:uses ;
    owl:someValuesFrom ex:Sensor ] .
"""


class OntologyCliTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / "index.md").write_text("""---
investment:
  consistency:
    model: gamma-poisson
    time_unit: day
    alpha: 1.0
    beta: 365.0
    horizon: 30.0
  connection:
    target: 1
---
Root.
""", encoding="utf-8")
        (self.root / "vocabulary.ttl").write_text(VOCABULARY)
        (self.root / "requirements.ttl").write_text(REQUIREMENTS)
        (self.root / "axioms.ttl").write_text("")
        bundle = self.root / "topic"
        bundle.mkdir()
        self._concept(bundle / "index.md", ["topic", "Group"],
                      "Topic.\n\n---\n\n# Contents\n\n"
                      "- [Rover](rover.md)\n- [Sensor](sensor.md)\n")
        self.rover = bundle / "rover.md"
        self.sensor = bundle / "sensor.md"
        self._concept(self.rover, ["topic", "Rover"], "")
        self._concept(self.sensor, ["topic", "Sensor"], "")

    def tearDown(self):
        self.directory.cleanup()

    def _concept(self, path, tags, body):
        path.write_text("---\ntype: Concept\ntitle: Example\n"
                        "description: Example concept.\n"
                        "tags: [" + ", ".join(tags) + "]\n"
                        "history:\n  created: 2024-01-01T00:00:00Z\n"
                        "  updates: []\n---\n" + body,
                        encoding="utf-8")

    def _run(self, *args):
        output, errors = StringIO(), StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            code = main(list(args) + ["--root", str(self.root)])
        return code, output.getvalue(), errors.getvalue()

    def test_open_gap_and_fulfilled_link_reports(self):
        code, output, _ = self._run("ontology", "requirements")
        self.assertEqual(code, 0)
        self.assertEqual(output.splitlines()[0],
                         "concept\tclass\tproperty\tfiller\tdirection\tlink")
        self.assertNotIn("status", output)
        self.assertNotIn("requirement_id", output)
        self.assertIn("/topic/rover.md\t", output)
        self.assertTrue(any(
            line.endswith("\t") for line in output.splitlines()[1:]
        ))
        code, verify_output, _ = self._run(
            "verify", "topic/rover.md", "--as-of", "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 0)
        self.assertIn("result\tvalid", verify_output)

        self._concept(self.rover, ["topic", "Rover"],
                      "[Sensor](sensor.md)\n")
        code, output, _ = self._run("ontology", "requirements")
        self.assertEqual(code, 0)
        self.assertIn("/topic/sensor.md", output)
        code, terms, _ = self._run("ontology", "terms")
        self.assertEqual(code, 0)
        self.assertIn("/topic/rover.md\tRover\t", terms)
        code, facts, _ = self._run("ontology", "facts")
        self.assertEqual(code, 0)
        self.assertIn("https://example.org/uses", facts)
        self.assertIn("asserted\t/topic/rover.md -> /topic/sensor.md", facts)
        code, investment, _ = self._run(
            "investment", "topic/rover.md", "--as-of", "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 0)
        self.assertIn("fulfilled\t1", investment)
        self.assertIn("open\t0", investment)
        self.assertIn("qualifying_links\t1", investment)
        self.assertIn("connection\t1.000000", investment)
        code, sensor_investment, _ = self._run(
            "investment", "topic/sensor.md", "--as-of",
            "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 0)
        self.assertIn("fulfilled\t0", sensor_investment)
        self.assertIn("open\t0", sensor_investment)
        self.assertIn("qualifying_links\t1", sensor_investment)
        self.assertIn("connection\t1.000000", sensor_investment)

    def test_profile_error_is_verification_finding(self):
        (self.root / "requirements.ttl").write_text('''\
@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
ex:Rover owl:equivalentClass [ owl:complementOf ex:Sensor ] .
''')
        code, output, _ = self._run(
            "verify", "topic/rover.md", "--as-of", "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 1)
        self.assertIn("ontology\t", output)
        self.assertIn("OWL 2 EL profile violation", output)

    def test_missing_root_ontology_file_is_verification_finding(self):
        (self.root / "axioms.ttl").unlink()
        code, output, _ = self._run(
            "verify", "topic/rover.md", "--as-of", "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 1)
        self.assertIn("axioms.ttl: required ontology file is missing", output)

    def test_turtle_error_identifies_file(self):
        (self.root / "requirements.ttl").write_text("ex:broken [\n")
        code, output, _ = self._run(
            "verify", "topic/rover.md", "--as-of", "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 1)
        self.assertIn("requirements.ttl: invalid Turtle", output)

    def test_multiple_links_repeat_requirement_without_recounting_it(self):
        second = self.root / "topic" / "sensor-two.md"
        self._concept(second, ["topic", "Sensor"], "")
        self._concept(self.rover, ["topic", "Rover"],
                      "[first](sensor.md) and [second](sensor-two.md).\n")
        code, output, _ = self._run("ontology", "requirements")
        self.assertEqual(code, 0)
        rover_rows = [line for line in output.splitlines()
                      if line.startswith("/topic/rover.md\t")]
        self.assertEqual(len(rover_rows), 2)
        self.assertTrue(any(row.endswith("/topic/sensor.md")
                            for row in rover_rows))
        self.assertTrue(any(row.endswith("/topic/sensor-two.md")
                            for row in rover_rows))
        code, investment, _ = self._run(
            "investment", "topic/rover.md", "--as-of", "2024-01-11T00:00:00Z"
        )
        self.assertEqual(code, 0)
        self.assertIn("fulfilled\t1", investment)
        self.assertIn("qualifying_links\t2", investment)


if __name__ == "__main__":
    unittest.main()
