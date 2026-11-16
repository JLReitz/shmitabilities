"""Document edge provenance in the connections report."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_cli.connections import collect_connections, render_connections
from knowledge_cli.document import load_document
from knowledge_cli.ontology import OntologyFact, OntologySnapshot, TermMatch


class ConnectionGraphTests(unittest.TestCase):
    def test_ontology_assertion_uses_pair_scope_without_cross_product(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "ontology.ttl").write_text("", encoding="utf-8")
            paths = [root / f"{name}.md" for name in ("source", "one", "two")]
            for path in paths:
                path.write_text(
                    f"---\ntype: Concept\ntags: [{path.stem}]\n---\nText.\n",
                    encoding="utf-8",
                )

            def scoped(_root, endpoints):
                source, target = endpoints
                terms = (
                    TermMatch(source, source.stem, "urn:source", "individual", "exact"),
                    TermMatch(target, target.stem, "urn:shared", "individual", "exact"),
                )
                facts = (
                    OntologyFact("urn:source", "urn:related", "urn:shared", False),
                ) if target == paths[1] else ()
                return OntologySnapshot(terms, facts, (), {})

            with patch("knowledge_cli.ontology._build_snapshot_scoped", side_effect=scoped):
                graph = collect_connections(root, load_document(paths[0]))

            self.assertEqual([edge.target for edge in graph.connections], [paths[1]])
            self.assertEqual(graph.connections[0].basis, "ontology assertion")

    def test_derived_edge_is_reported_and_traversed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "ontology.ttl").write_text("", encoding="utf-8")
            source = root / "source.md"
            target = root / "target.md"
            source.write_text("---\ntype: Concept\ntags: [Source]\n---\nSource.\n", encoding="utf-8")
            target.write_text("---\ntype: Concept\ntags: [Target]\n---\nTarget.\n", encoding="utf-8")
            snapshot = OntologySnapshot(
                (TermMatch(source, "Source", "urn:source", "individual", "exact"),
                 TermMatch(target, "Target", "urn:target", "individual", "exact")),
                (OntologyFact("urn:source", "urn:related", "urn:target", True),),
                (), {},
            )

            with patch("knowledge_cli.ontology._build_snapshot_scoped", return_value=snapshot):
                graph = collect_connections(root, load_document(source))

            self.assertEqual(len(graph.connections), 1)
            self.assertEqual(graph.connections[0].origin, "derived")
            self.assertIn("derived\turn:related\tontology inference", render_connections(root, load_document(source), graph))


if __name__ == "__main__":
    unittest.main()
