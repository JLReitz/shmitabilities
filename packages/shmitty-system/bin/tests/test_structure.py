import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from knowledge_cli.connections import collect_connections, implicit_index_targets
from knowledge_cli.document import load_document
from knowledge_cli.reading import expand_read, reference_indexes
from knowledge_cli.validation import index_contents_findings, reference_root


class StructureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_topic_children_are_structural_not_authored_connections(self):
        index = self.write("topic/index.md", "---\ntype: Concept\ntags: [topic, term]\n---\nAbstract.\n\n---\n\n- [Child](child.md)\n")
        child = self.write("topic/child.md", "---\ntype: Concept\ntags: [topic, term]\n---\nChild.\n")
        topic = load_document(index)

        self.assertEqual(implicit_index_targets(topic), (child.resolve(),))
        self.assertEqual(collect_connections(self.root, topic).connections, ())
        self.assertEqual(index_contents_findings(self.root, topic), [])

    def test_topic_contents_reject_nonchild(self):
        index = self.write("topic/index.md", "---\ntype: Concept\ntags: [topic, term]\n---\nAbstract.\n\n---\n\n- [Other](/other.md)\n")
        self.write("other.md", "---\ntype: Concept\ntags: [term]\n---\nOther.\n")

        self.assertTrue(any("non-child" in finding.message for finding in index_contents_findings(self.root, load_document(index))))

    def test_source_hierarchy_supplies_ancestor_context(self):
        self.write("sources/domain/index.md", "---\ntype: Reference\n---\nDomain.\n\n---\n\n- [Page](page.md)\n")
        page = self.write("sources/domain/page.md", "---\ntype: Reference\n---\nPage.\n")

        self.assertEqual(reference_root(self.root, page), self.root / "sources")
        self.assertEqual([item.path.name for item in expand_read(self.root, [page])], ["index.md", "page.md"])

    def test_tool_hierarchy_uses_tool_index(self):
        self.write("tools/widget/index.md", "---\ntype: Reference\n---\nWidget.\n\n---\n\n- [Command](command.md)\n")
        command = self.write("tools/widget/command.md", "---\ntype: Reference\n---\nCommand.\n")

        self.assertEqual(list(reference_indexes(self.root, load_document(command))), [self.root / "tools/widget/index.md"])

    def test_reference_contents_accept_immediate_child(self):
        index = self.write("sources/domain/index.md", "---\ntype: Reference\n---\nDomain.\n\n---\n\n- [Page](page.md)\n")
        self.write("sources/domain/page.md", "---\ntype: Reference\n---\nPage.\n")

        self.assertEqual(index_contents_findings(self.root, load_document(index)), [])

    def test_malformed_immediate_child_is_reported(self):
        index = self.write("topic/index.md", "---\ntype: Concept\ntags: [topic, term]\n---\nAbstract.\n\n---\n\n")
        self.write("topic/broken.md", "No frontmatter.\n")

        self.assertTrue(any("missing YAML frontmatter" in finding.message for finding in index_contents_findings(self.root, load_document(index))))


if __name__ == "__main__":
    unittest.main()
