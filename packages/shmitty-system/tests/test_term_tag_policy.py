"""Term-tag classification and verification policy tests."""

from pathlib import Path
from tempfile import TemporaryDirectory
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bin"))

from knowledge_cli.document import load_document
from knowledge_cli.errors import KnowledgeError
from knowledge_cli.ontology import tag_classification
from knowledge_cli.validation import tag_findings


PREFIXES = """@prefix ex: <https://example.org/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix sk: <urn:shmitty:knowledge:> .
"""


class TermTagPolicyTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "ontology.ttl").write_text(
            PREFIXES + 'ex:Tree a owl:Class .\n'
            'sk:plainTag a owl:AnnotationProperty .\n'
            'ex:vocabulary a owl:Ontology ; sk:plainTag "Plain" .\n',
            encoding="utf-8",
        )
        self.index = self.root / "index.md"

    def document(self, policy=None):
        ontology = "" if policy is None else f"ontology:\n  term_tags: {policy}\n"
        self.index.write_text(
            f"---\ntype: Concept\ntags: [Tree, Plain, Missing]\n{ontology}---\nTree.\n",
            encoding="utf-8",
        )
        return load_document(self.index)

    def test_plain_tag_follows_ontology_match(self):
        document = self.document()

        self.assertEqual(
            tag_classification(self.root, document),
            (("Tree",), ("Plain",), ("Missing",)),
        )

    def test_plain_tag_requires_annotation_property_declaration(self):
        ontology = self.root / "ontology.ttl"
        ontology.write_text(
            PREFIXES + 'ex:Tree a owl:Class .\n'
            'ex:vocabulary a owl:Ontology ; sk:plainTag "Plain" .\n',
            encoding="utf-8",
        )
        document = self.document()

        with self.assertRaisesRegex(KnowledgeError, "plainTag must be declared"):
            tag_classification(self.root, document)

    def test_required_warn_and_absent_policy(self):
        for policy, severity in (("required", "error"), ("warn", "warning"), (None, None)):
            with self.subTest(policy=policy):
                document = self.document(policy)
                findings = tag_findings(self.root, document)
                unmatched = [item for item in findings if "unmatched ontology" in item.message]
                self.assertEqual([item.severity for item in unmatched], [severity] if severity else [])


if __name__ == "__main__":
    unittest.main()
