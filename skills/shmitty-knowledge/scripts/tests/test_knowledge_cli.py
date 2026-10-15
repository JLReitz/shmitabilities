import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

from knowledge_cli.commands import main, parser
from knowledge_cli.confidence import (
    citation_coverage,
    combine_confidence,
    evaluate_confidence,
    render_confidence,
)
from knowledge_cli.connections import collect_connections, render_connections
from knowledge_cli.document import load_document
from knowledge_cli.investment import evaluate
from knowledge_cli.paths import markdown_targets
from knowledge_cli.reading import expand_read, render_read
from knowledge_cli.validation import verify


class KnowledgeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.write(
            "index.md",
            """---
knowledge_format_version: "1.0"
investment:
  consistency:
    model: gamma-poisson
    time_unit: day
    alpha: 1.0
    beta: 365.0
    horizon: 30.0
---
# Test tree
""",
        )
        self.write(
            "references/example.com/index.md",
            """---
type: Reference
title: Example domain
description: Complete example.com source.
tags: [references, example.com, test]
resource: https://example.com/
resource_type: Website
timestamp: 2024-01-01T00:00:00Z
---
Example domain abstract.

---

# Contents

- [Source](source.md)
""",
        )
        self.write(
            "references/example.com/source.md",
            """---
type: Reference
title: Source
description: Persistent source.
tags: [references, example.com, test]
resource: https://example.com/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
Source abstract.
""",
        )
        self.write(
            "bundle-a/index.md",
            """---
type: Concept
title: Bundle A
description: Test topic index.
tags: [bundle-a, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )
        self.write(
            "bundle-a/other.md",
            """---
type: Concept
title: Other
description: Another concept.
tags: [bundle-a, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )

    def tearDown(self):
        self.temp.cleanup()

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if (
            path.name == "index.md"
            and "type: " in content
            and "\n---\n" not in content.split("---", 2)[-1]
        ):
            content = content.rstrip("\n") + "\n\n---\n\n"
        path.write_text(content, encoding="utf-8")
        return path

    def verify_path(self, path):
        return verify(
            self.root,
            load_document(path),
            datetime(2024, 1, 11, tzinfo=timezone.utc),
        )

    def test_root_defaults_to_environment_variable(self):
        import os

        self.concept()
        previous = os.environ.get("SHMIT_KNOWLEDGE_ROOT")
        os.environ["SHMIT_KNOWLEDGE_ROOT"] = str(self.root)
        try:
            self.assertEqual(main(["confidence", "bundle-a/target.md"]), 0)
        finally:
            if previous is None:
                os.environ.pop("SHMIT_KNOWLEDGE_ROOT", None)
            else:
                os.environ["SHMIT_KNOWLEDGE_ROOT"] = previous

    def test_explicit_root_overrides_environment_variable(self):
        import os

        self.concept()
        previous = os.environ.get("SHMIT_KNOWLEDGE_ROOT")
        os.environ["SHMIT_KNOWLEDGE_ROOT"] = str(self.root / "missing")
        try:
            self.assertEqual(
                main([
                    "confidence", "bundle-a/target.md", "--root",
                    str(self.root),
                ]),
                0,
            )
        finally:
            if previous is None:
                os.environ.pop("SHMIT_KNOWLEDGE_ROOT", None)
            else:
                os.environ["SHMIT_KNOWLEDGE_ROOT"] = previous

    def test_search_filters_tags_type_and_subtype(self):
        self.concept(tags="bundle-a, test, shared")
        self.write(
            "bundle-a/metric.md",
            """---
type: Concept
concept_type: Metric
title: Metric
tags: [bundle-a, test, shared]
---
Metric definition.
""",
        )
        self.write(
            "references/example.com/command.md",
            """---
type: Reference
reference_type: Command
title: Command
tags: [references, example.com, test, shared]
---
Command abstract.
""",
        )

        output = StringIO()
        with redirect_stdout(output):
            status = main([
                "search", "--tag", "test", "--tag", "shared",
                "--type", "Reference", "--subtype", "Command",
                "--root", str(self.root),
            ])
        self.assertEqual(status, 0)
        self.assertEqual(output.getvalue().splitlines(), [
            "document\ttype\tsubtype\ttags\ttitle",
            "references/example.com/command.md\tReference\tCommand\t"
            "references, example.com, test, shared\tCommand",
        ])

        output = StringIO()
        with redirect_stdout(output):
            status = main([
                "search", "--subtype", "Metric", "--root", str(self.root),
            ])
        self.assertEqual(status, 0)
        self.assertIn("bundle-a/metric.md\tConcept\tMetric\t", output.getvalue())
        self.assertNotIn("command.md", output.getvalue())

    def test_search_lists_documents_and_skips_unreadable_files(self):
        self.concept()
        self.write("bundle-a/broken.md", "missing frontmatter\n")
        output = StringIO()
        with redirect_stdout(output):
            status = main(["search", "--root", str(self.root)])
        self.assertEqual(status, 0)
        self.assertIn("bundle-a/target.md\tConcept\t", output.getvalue())
        self.assertNotIn("broken.md", output.getvalue())
        self.assertNotIn("\nindex.md\t", output.getvalue())

    def concept(self, body=None, tags="bundle-a, test"):
        if body is None:
            body = (
                "See [source](/references/example.com/source.md) "
                "and [other](/bundle-a/other.md)."
            )
        return self.write(
            "bundle-a/target.md",
            f"""---
type: Concept
title: Target
description: Target concept.
tags: [{tags}]
history:
  created: 2024-01-01T00:00:00Z
  updates:
    - 2024-01-02T00:00:00Z
---
{body}
""",
        )

    def test_evaluates_investment(self):
        document = load_document(self.concept())
        as_of = datetime(2024, 1, 11, tzinfo=timezone.utc)
        score = evaluate(self.root, document, as_of)
        expected_consistency = (375.0 / 405.0) ** 2
        self.assertEqual(score.confidence, 1.0)
        self.assertAlmostEqual(score.consistency, expected_consistency)
        self.assertAlmostEqual(score.total, expected_consistency)

    def test_verify_requires_history_created(self):
        path = self.concept()
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                "  created: 2024-01-01T00:00:00Z\n", ""
            ),
            encoding="utf-8",
        )
        findings = self.verify_path(path)
        self.assertTrue(
            any(
                finding.field == "history"
                and "history.created" in finding.message
                for finding in findings
            )
        )

    def test_citation_coverage_is_union_of_shared_topical_tags(self):
        document = load_document(
            self.concept(tags="bundle-a, test, uncovered")
        )
        graph = collect_connections(self.root, document)
        self.assertEqual(citation_coverage(self.root, document, graph), 0.5)

    def test_confidence_divides_only_when_both_inputs_are_nonzero(self):
        self.assertEqual(combine_confidence(1.0, 0.0), 1.0)
        self.assertEqual(combine_confidence(0.0, 0.5), 0.5)
        self.assertEqual(combine_confidence(1.0, 0.5), 0.75)
        self.assertEqual(combine_confidence(0.0, 0.0), 0.0)

    def test_confidence_recursively_uses_linked_concepts(self):
        self.write(
            "bundle-a/other.md",
            """---
type: Concept
title: Other
description: Another concept.
tags: [bundle-a, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
See [source](/references/example.com/source.md).
""",
        )
        document = load_document(self.concept())
        self.assertEqual(
            evaluate_confidence(self.root, document).score(document), 1.0
        )

    def test_recursive_confidence_stops_at_active_concept_cycle(self):
        other = self.write(
            "bundle-a/other.md",
            """---
type: Concept
title: Other
description: Another concept.
tags: [bundle-a, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
See [target](/bundle-a/target.md) and
[source](/references/example.com/source.md).
""",
        )
        document = load_document(self.concept())
        self.assertTrue(other.exists())
        self.assertAlmostEqual(
            evaluate_confidence(self.root, document).score(document), 1.0
        )

    def test_confidence_report_defaults_to_direct_concepts_and_all_recurses(
        self,
    ):
        self.write(
            "bundle-a/leaf.md",
            """---
type: Concept
title: Leaf
description: Leaf concept.
tags: [bundle-a, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )
        self.write(
            "bundle-a/other.md",
            """---
type: Concept
title: Other
description: Another concept.
tags: [bundle-a, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
See [leaf](/bundle-a/leaf.md).
""",
        )
        document = load_document(self.concept())
        evaluation = evaluate_confidence(self.root, document)
        direct = render_confidence(self.root, document, evaluation, False)
        recursive = render_confidence(self.root, document, evaluation, True)
        self.assertIn("/bundle-a/target.md", direct)
        self.assertIn("/bundle-a/other.md", direct)
        self.assertNotIn("/bundle-a/leaf.md", direct)
        self.assertIn("/bundle-a/leaf.md", recursive)

    def test_connections_recurse_stop_at_references_and_show_shared_tags(self):
        self.write(
            "bundle-a/other.md",
            """---
type: Concept
title: Other
description: Another concept.
tags: [bundle-a, test, linked]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
See [source](/references/example.com/source.md).
""",
        )
        document = load_document(self.concept())
        graph = collect_connections(self.root, document)
        output = render_connections(self.root, document, graph)
        self.assertEqual(len(graph.connections), 3)
        self.assertIn(
            "1\t/bundle-a/target.md\t/bundle-a/other.md\tConcept\t"
            "bundle-a, test",
            output,
        )
        self.assertIn("Reference\t", output)
        self.assertNotIn("`", output)
        self.assertNotIn("/references/example.com/index.md", output)

    def test_concept_index_implicitly_connects_to_child_documents(self):
        target = self.concept()
        topic_index = load_document(self.root / "bundle-a/index.md")
        graph = collect_connections(self.root, topic_index)
        paths = {connection.target for connection in graph.connections}
        self.assertIn(target.resolve(), paths)
        self.assertIn((self.root / "bundle-a/other.md").resolve(), paths)

    def test_read_directory_targets_concept_index(self):
        documents = expand_read(self.root, [Path("bundle-a")])
        self.assertEqual(documents[0].path, self.root / "bundle-a/index.md")

    def test_valid_concept_has_no_findings(self):
        document = load_document(self.concept())
        as_of = datetime(2024, 1, 11, tzinfo=timezone.utc)
        self.assertEqual(verify(self.root, document, as_of), [])

    def test_verify_reports_missing_required_concept_metadata(self):
        path = self.concept()
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                "title: Target\ndescription: Target concept.\n", ""
            ),
            encoding="utf-8",
        )
        findings = self.verify_path(path)
        self.assertEqual(
            {finding.field for finding in findings},
            {"title", "description"},
        )

    def test_verify_reports_missing_required_reference_metadata(self):
        path = self.root / "references/example.com/source.md"
        text = path.read_text(encoding="utf-8")
        for line in (
            "resource: https://example.com/source\n",
            "resource_type: Webpage\n",
            "timestamp: 2024-01-01T00:00:00Z\n",
        ):
            text = text.replace(line, "")
        path.write_text(text, encoding="utf-8")
        findings = self.verify_path(path)
        self.assertEqual(
            {finding.field for finding in findings},
            {"resource", "resource_type", "timestamp"},
        )

    def test_verify_requires_http_or_https_resource_url(self):
        path = self.root / "references/example.com/source.md"
        original = path.read_text(encoding="utf-8")
        invalid_resources = (
            "file:///mnt/f/source.md",
            "mailto:source@example.com",
            "relative/source.md",
            "https://",
            "https://[broken",
            "https://example.com:bad/source",
            "https://exa mple.com/source",
        )
        for resource in invalid_resources:
            with self.subTest(resource=resource):
                path.write_text(
                    original.replace(
                        "https://example.com/source", resource
                    ),
                    encoding="utf-8",
                )
                self.assertTrue(
                    any(
                        finding.field == "resource"
                        for finding in self.verify_path(path)
                    )
                )
        path.write_text(
            original.replace(
                "https://example.com/source", "http://example.com/source"
            ),
            encoding="utf-8",
        )
        self.assertFalse(
            any(
                finding.field == "resource"
                for finding in self.verify_path(path)
            )
        )

    def test_verify_reports_missing_ancestor_concept_index(self):
        self.write(
            "bundle-a/topic/index.md",
            """---
type: Concept
title: Topic
description: Nested topic.
tags: [bundle-a, topic, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )
        path = self.write(
            "bundle-a/topic/item.md",
            """---
type: Concept
title: Item
description: Nested item.
tags: [bundle-a, topic, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )
        (self.root / "bundle-a/index.md").unlink()
        findings = self.verify_path(path)
        self.assertTrue(any(
            "bundle-a/index.md" in finding.message for finding in findings
        ))

    def test_command_error_uses_status_one(self):
        error_output = StringIO()
        with redirect_stderr(error_output):
            status = main(["read", "missing.md", "--root", str(self.root)])
        self.assertEqual(status, 1)
        self.assertIn("cannot read document", error_output.getvalue())

    def test_verify_rejects_link_fragment(self):
        path = self.concept(
            body="See [source](/references/example.com/source.md#details)."
        )
        findings = self.verify_path(path)
        self.assertTrue(
            any("fragment link" in finding.message for finding in findings)
        )

    def test_markdown_targets_supports_references_and_autolinks(self):
        targets = list(markdown_targets(
            """[Full][source] [Collapsed][] [Shortcut]
<https://example.org/source> <agent@example.org>

[source]: /references/example.com/source.md
[collapsed]: </bundle-a/other.md> "Title"
[shortcut]: /bundle-a/index.md
"""
        ))
        self.assertEqual(
            targets,
            [
                "/references/example.com/source.md",
                "/bundle-a/other.md",
                "/bundle-a/index.md",
                "https://example.org/source",
                "mailto:agent@example.org",
            ],
        )

    def test_markdown_targets_ignores_fences_and_images(self):
        targets = list(markdown_targets(
            """[Visible][source]

````markdown
[Inline](https://example.org/inline)
[Reference][hidden]
<https://example.org/autolink>
[hidden]: https://example.org/hidden
```
[Still fenced](https://example.org/still-fenced)
````

~~~
[Other](https://example.org/other)
~~~

![Inline image](<https://example.org/image.png>)
![Reference image][source]
![Shortcut image]

[source]: /references/example.com/source.md
[Shortcut image]: https://example.org/shortcut.png
"""
        ))
        self.assertEqual(
            targets,
            ["/references/example.com/source.md"],
        )

    def test_markdown_targets_does_not_duplicate_nested_autolink(self):
        targets = list(markdown_targets(
            "[Source](<https://example.org/source>)"
        ))
        self.assertEqual(targets, ["https://example.org/source"])

    def test_verify_rejects_reference_style_and_autolink_urls(self):
        path = self.concept(
            body="""See [external][source] and <https://example.org/other>.

[source]: https://example.org/source
"""
        )
        findings = self.verify_path(path)
        self.assertEqual(
            sum(
                "external or fragment link" in finding.message
                for finding in findings
            ),
            2,
        )

    def test_verify_ignores_link_like_text_in_fenced_code(self):
        path = self.concept(
            body="""See [source](/references/example.com/source.md).

```markdown
[External](https://example.org)
<https://example.org/other>
```
"""
        )
        self.assertEqual(self.verify_path(path), [])

    def test_verify_rejects_duplicate_inline_filepaths(self):
        path = self.concept(
            body="""See [first](/references/example.com/source.md).
See [second](../references/example.com/source.md).
"""
        )
        findings = self.verify_path(path)
        self.assertTrue(any(
            "duplicate link filepath" in finding.message
            for finding in findings
        ))

    def test_verify_accepts_repeated_reference_style_link(self):
        path = self.concept(
            body="""See [first claim][source] and [second claim][source].

[source]: /references/example.com/source.md
"""
        )
        self.assertEqual(self.verify_path(path), [])

    def test_verify_rejects_duplicate_reference_definitions(self):
        path = self.concept(
            body="""See [first][source-a] and [second][source-b].

[source-a]: /references/example.com/source.md
[source-b]: ../references/example.com/source.md
"""
        )
        findings = self.verify_path(path)
        self.assertTrue(any(
            "duplicate link filepath" in finding.message
            for finding in findings
        ))

    def test_verify_rejects_wrong_reference_ancestor_type(self):
        abstract = self.root / "references/example.com/index.md"
        abstract.write_text(
            abstract.read_text(encoding="utf-8").replace(
                "type: Reference", "type: Concept"
            ),
            encoding="utf-8",
        )
        path = self.root / "references/example.com/source.md"
        findings = self.verify_path(path)
        self.assertTrue(
            any("not a Reference" in finding.message for finding in findings)
        )

    def test_policy_rejects_nonfinite_parameter(self):
        index = self.root / "index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "alpha: 1.0", "alpha: .nan"
            ),
            encoding="utf-8",
        )
        document = load_document(self.concept())
        findings = self.verify_path(document.path)
        self.assertTrue(
            any(
                "alpha, beta, and horizon" in finding.message
                for finding in findings
            )
        )

    def test_required_confidence_rejects_non_open_zero_confidence_concept(
        self,
    ):
        index = self.root / "index.md"
        text = index.read_text(encoding="utf-8").replace(
            'knowledge_format_version: "1.0"\n',
            'knowledge_format_version: "1.0"\nconfidence:\n  required: true\n',
        )
        index.write_text(text, encoding="utf-8")
        document = load_document(self.concept(body="Unsupported claim."))
        findings = verify(
            self.root, document, datetime(2024, 1, 11, tzinfo=timezone.utc)
        )
        self.assertTrue(
            any(
                finding.field == "confidence"
                and "zero confidence" in finding.message
                for finding in findings
            )
        )

    def test_required_confidence_accepts_open_concept(self):
        index = self.root / "index.md"
        text = index.read_text(encoding="utf-8").replace(
            'knowledge_format_version: "1.0"\n',
            'knowledge_format_version: "1.0"\nconfidence:\n  required: true\n',
        )
        index.write_text(text, encoding="utf-8")
        document = load_document(self.concept(body=""))
        self.assertEqual(
            self.verify_path(document.path),
            [],
        )

    def test_zero_confidence_is_allowed_when_confidence_is_not_required(self):
        document = load_document(self.concept(body="Unsupported claim."))
        self.assertEqual(
            self.verify_path(document.path),
            [],
        )

    def test_confidence_required_must_be_boolean(self):
        index = self.root / "index.md"
        text = index.read_text(encoding="utf-8").replace(
            'knowledge_format_version: "1.0"\n',
            'knowledge_format_version: "1.0"\n'
            'confidence:\n  required: yes-please\n',
        )
        index.write_text(text, encoding="utf-8")
        document = load_document(self.concept())
        findings = verify(
            self.root, document, datetime(2024, 1, 11, tzinfo=timezone.utc)
        )
        self.assertTrue(
            any(
                "confidence.required must be a boolean" in finding.message
                for finding in findings
            )
        )

    def test_root_option_accepts_tree_root(self):
        args = parser().parse_args(
            ["verify", "bundle-a/target.md", "--root", str(self.root)]
        )
        self.assertEqual(args.root, self.root)

    def test_confidence_accepts_all_flag(self):
        args = parser().parse_args(
            [
                "confidence", "bundle-a/target.md", "--root", str(self.root),
                "--all",
            ]
        )
        self.assertTrue(args.all)

    def test_read_accepts_multiple_documents(self):
        args = parser().parse_args(
            [
                "read", "bundle-a/target.md", "bundle-a/other.md",
                "--root", str(self.root),
            ]
        )
        self.assertEqual(
            args.documents,
            [Path("bundle-a/target.md"), Path("bundle-a/other.md")],
        )

    def test_read_renders_concept_fields_and_body(self):
        self.concept(body="Concept body.")
        documents = expand_read(self.root, [Path("bundle-a/target.md")])
        output = render_read(self.root, documents)
        self.assertIn(
            "# /bundle-a/target.md\n**Tags:** bundle-a, test\n"
            "Concept body.",
            output,
        )
        self.assertNotIn("`", output)

    def test_read_prepends_concept_index(self):
        self.concept(body="Concept body.")
        documents = expand_read(self.root, [Path("bundle-a/target.md")])
        self.assertEqual(
            [document.path.name for document in documents],
            ["index.md", "target.md"],
        )
        output = render_read(self.root, documents)
        self.assertLess(
            output.index("# /bundle-a/index.md"),
            output.index("# /bundle-a/target.md"),
        )

    def test_read_prepends_nested_abstracts_once(self):
        reference_template = """---
type: Reference
title: {title}
description: {description}
tags: [references, example.com, guide, test]
resource: https://example.com/{resource}
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
{body}
"""
        self.write(
            "references/example.com/index.md",
            reference_template.format(
                title="Domain", description="Domain abstract.",
                resource="domain", body="Domain body.",
            ),
        )
        self.write(
            "references/example.com/guide/index.md",
            reference_template.format(
                title="Guide", description="Guide abstract.",
                resource="guide", body="Guide body.",
            ),
        )
        first = self.write(
            "references/example.com/guide/first.md",
            reference_template.format(
                title="First", description="First reference.",
                resource="first", body="First body.",
            ),
        )
        second = self.write(
            "references/example.com/guide/second.md",
            reference_template.format(
                title="Second", description="Second reference.",
                resource="second", body="Second body.",
            ),
        )
        documents = expand_read(self.root, [first, second])
        paths = [
            document.path.relative_to(self.root).as_posix()
            for document in documents
        ]
        self.assertEqual(
            paths,
            [
                "references/example.com/index.md",
                "references/example.com/guide/index.md",
                "references/example.com/guide/first.md",
                "references/example.com/guide/second.md",
            ],
        )
        output = render_read(self.root, documents)
        self.assertEqual(output.count("Domain body."), 1)
        self.assertEqual(output.count("Guide body."), 1)
        self.assertIn(
            "# /references/example.com/guide/first.md\n"
            "**Tags:** references, example.com, guide, test\n"
            "https://example.com/first",
            output,
        )

    def test_reference_reports_missing_ancestor_abstract(self):
        reference = self.write(
            "references/example.com/missing-scope/source.md",
            """---
type: Reference
title: Missing scope
description: Reference below a directory without an abstract.
tags: [references, example.com, missing-scope, test]
resource: https://example.com/missing-scope/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
Source body.
""",
        )
        findings = self.verify_path(reference)
        self.assertTrue(
            any(
                "missing required index.md" in finding.message
                for finding in findings
            )
        )

    def test_concept_may_link_across_bundles(self):
        self.write(
            "bundle-b/index.md",
            """---
type: Concept
title: Bundle B
description: Cross-bundle topic index.
tags: [bundle-b, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )
        self.write(
            "bundle-b/concept.md",
            """---
type: Concept
title: Cross-bundle concept
description: Concept in another bundle.
tags: [bundle-b, test]
history:
  created: 2024-01-01T00:00:00Z
  updates: []
---
""",
        )
        document = load_document(
            self.concept(
                body="See [cross-bundle topic](/bundle-b/) "
                "and [source](/references/example.com/source.md)."
            )
        )
        as_of = datetime(2024, 1, 11, tzinfo=timezone.utc)
        self.assertEqual(verify(self.root, document, as_of), [])
        graph = collect_connections(self.root, document)
        self.assertIn(
            (self.root / "bundle-b/index.md").resolve(),
            graph.concept_links[document.path.resolve()],
        )

    def test_reference_may_not_link_outside_references_directory(self):
        reference = self.write(
            "references/example.com/outbound.md",
            """---
type: Reference
title: Outbound reference
description: Reference with a prohibited link.
tags: [references, example.com, test]
resource: https://example.com/outbound
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
See [another concept](/bundle-a/other.md).
""",
        )
        findings = self.verify_path(reference)
        self.assertTrue(
            any(
                "leaves the references directory" in finding.message
                for finding in findings
            )
        )

    def test_reference_may_link_within_references_directory(self):
        reference = self.write(
            "references/example.com/related.md",
            """---
type: Reference
title: Related reference
description: Reference with an internal link.
tags: [references, example.com, test]
resource: https://example.com/related
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
See [source](/references/example.com/source.md).
""",
        )
        findings = self.verify_path(reference)
        self.assertEqual(findings, [])

    def test_reference_rejects_invalid_link_targets(self):
        self.write("references/example.com/data.txt", "data\n")
        self.write("references/example.com/log.md", "# Log\n")
        self.write("references/index.md", "# References\n")
        reference = self.write(
            "references/example.com/invalid-links.md",
            """---
type: Reference
title: Invalid links
description: Reference with invalid links.
tags: [references, example.com, test]
resource: https://example.com/invalid-links
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
See [external](https://example.org),
[fragment](/references/example.com/source.md#part),
[missing](/references/example.com/missing.md),
[text](/references/example.com/data.txt),
[log](/references/example.com/log.md), and
[navigation](/references/index.md).
""",
        )
        messages = [
            finding.message for finding in self.verify_path(reference)
        ]
        self.assertTrue(
            any("external or fragment" in message for message in messages)
        )
        self.assertTrue(
            any("does not exist" in message for message in messages)
        )
        self.assertTrue(
            any("not a Markdown document" in message for message in messages)
        )
        self.assertTrue(
            any("reserved infrastructure" in message for message in messages)
        )
        self.assertTrue(
            any("untyped navigation index" in message for message in messages)
        )

    def test_reference_index_validates_table_of_contents_links(self):
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8")
            + "- [External](https://example.org)\n",
            encoding="utf-8",
        )
        findings = self.verify_path(index)
        self.assertTrue(
            any(
                "external or fragment" in finding.message
                for finding in findings
            )
        )

    def test_reference_index_requires_each_level_file_in_contents(self):
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "- [Source](source.md)\n", ""
            ),
            encoding="utf-8",
        )
        findings = self.verify_path(index)
        self.assertTrue(any(
            finding.field == "contents"
            and "source.md" in finding.message
            for finding in findings
        ))

    def test_reference_index_contents_accept_reference_style_link(self):
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "- [Source](source.md)",
                "- [Source][source]\n\n[source]: source.md",
            ),
            encoding="utf-8",
        )
        self.assertEqual(self.verify_path(index), [])

    def test_reference_index_requires_non_markdown_level_file_in_contents(self):
        extra = self.root / "references/example.com/attachment.txt"
        extra.write_text("attachment", encoding="utf-8")
        findings = self.verify_path(
            self.root / "references/example.com/index.md"
        )
        self.assertTrue(any(
            finding.field == "contents"
            and "attachment.txt" in finding.message
            for finding in findings
        ))

    def test_reference_index_contents_omit_index_and_log(self):
        log = self.root / "references/example.com/log.md"
        log.write_text("# Update Log\n", encoding="utf-8")
        findings = self.verify_path(
            self.root / "references/example.com/index.md"
        )
        self.assertFalse(any(
            finding.field == "contents"
            and (
                "index.md" in finding.message
                or "log.md" in finding.message
            )
            for finding in findings
        ))

    def test_reference_index_abstract_allows_any_external_directory_link(self):
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "Example domain abstract.",
                "See [concept](/bundle-a/other.md).",
            ),
            encoding="utf-8",
        )
        self.assertEqual(self.verify_path(index), [])

    def test_reference_index_abstract_uses_contents_definition(self):
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "Example domain abstract.",
                "See [concept][other].",
            )
            + "\n[other]: /bundle-a/other.md\n",
            encoding="utf-8",
        )
        self.assertEqual(self.verify_path(index), [])

    def test_reference_index_abstract_allows_same_bundle_sibling_link(self):
        self.write(
            "references/other.example/index.md",
            """---
type: Reference
title: Other domain
description: Complete other.example source.
tags: [references, other.example, test]
resource: https://other.example/
resource_type: Website
timestamp: 2024-01-01T00:00:00Z
---
Other domain abstract.
""",
        )
        sibling = self.write(
            "references/other.example/source.md",
            """---
type: Reference
title: Other source
description: Persistent other source.
tags: [references, other.example, test]
resource: https://other.example/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
Other source abstract.
""",
        )
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "Example domain abstract.",
                "See [other source](/references/other.example/source.md).",
            ),
            encoding="utf-8",
        )
        self.assertTrue(sibling.exists())
        self.assertEqual(self.verify_path(index), [])

    def test_reference_index_abstract_rejects_own_directory_link(self):
        index = self.root / "references/example.com/index.md"
        index.write_text(
            index.read_text(encoding="utf-8").replace(
                "Example domain abstract.",
                "See [source](source.md).",
            ),
            encoding="utf-8",
        )
        messages = [
            finding.message for finding in self.verify_path(index)
        ]
        self.assertTrue(any(
            "index abstract link targets its own directory" in message
            for message in messages
        ))

    def test_command_requires_execution_fields(self):
        command = self.write(
            "references/example.com/command.md",
            """---
type: Reference
reference_type: Command
title: Command
description: Sanctioned command.
tags: [references, example.com, test]
resource: https://example.com/command
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
Command reference.
""",
        )
        fields = {
            finding.field for finding in self.verify_path(command)
        }
        self.assertTrue(
            {"runtime", "command", "receipt", "attester.command"}
            <= fields
        )

    def test_computation_requires_commands_and_attestation_fields(self):
        computation = self.write(
            "references/example.com/computation.md",
            """---
type: Reference
reference_type: Computation
title: Computation
description: Sanctioned computation.
tags: [references, example.com, test]
resource: https://example.com/computation
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
commands:
  - runtime: ""
attester: {}
---
Computation reference.
""",
        )
        fields = {
            finding.field for finding in self.verify_path(computation)
        }
        self.assertTrue(
            {
                "commands",
                "commands[0].runtime",
                "commands[0].command",
                "receipt",
                "attester.command",
            }
            <= fields
        )

    def test_valid_command_and_computation_subtypes(self):
        command = self.write(
            "references/example.com/command.md",
            """---
type: Reference
reference_type: Command
title: Command
description: Sanctioned command.
tags: [references, example.com, test]
resource: https://example.com/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
runtime: bash
command: run-query
receipt: [result]
attester:
  command: check-query
---
Command reference.
""",
        )
        computation = self.write(
            "references/example.com/computation.md",
            """---
type: Reference
reference_type: Computation
title: Computation
description: Sanctioned computation.
tags: [references, example.com, test]
resource: https://example.com/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
commands:
  - runtime: bash
    command: run-query
  - runtime: bash
    command: summarize-query
receipt: [result]
attester:
  command: check-query
---
Computation reference.
""",
        )
        self.assertEqual(self.verify_path(command), [])
        self.assertEqual(self.verify_path(computation), [])

    def test_package_and_execution_resources_require_source_reference(self):
        command = self.write(
            "references/example.com/unmatched-command.md",
            """---
type: Reference
reference_type: Command
title: Unmatched command
description: Sanctioned command without a source match.
tags: [references, example.com, test]
resource: https://example.com/unmatched
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
runtime: bash
command: run-query
receipt: [result]
attester:
  command: check-query
---
Command reference.
""",
        )
        messages = [
            finding.message for finding in self.verify_path(command)
        ]
        self.assertTrue(any(
            "must match an ordinary source Reference" in message
            for message in messages
        ))

        text = command.read_text(encoding="utf-8").replace(
            "https://example.com/unmatched",
            "HTTPS://EXAMPLE.COM/source#details",
        )
        command.write_text(text, encoding="utf-8")
        self.assertEqual(self.verify_path(command), [])

    def test_package_contents_allow_sources_and_computations(self):
        package = self.write(
            "references/packages/widget/index.md",
            """---
type: Reference
reference_type: Package
title: Widget package
description: Installed Widget package.
tags: [references, packages, widget, test]
resource: https://example.com/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
---
Widget package abstract.

---

# Contents

- [Source documentation](../../example.com/source.md)
- [Compute Widget state](state.md)
""",
        )
        computation = self.write(
            "references/packages/widget/state.md",
            """---
type: Reference
reference_type: Computation
title: Compute Widget state
description: Computes Widget state.
tags: [references, packages, widget, test]
resource: https://example.com/source
resource_type: Webpage
timestamp: 2024-01-01T00:00:00Z
commands:
  - runtime: bash
    command: widget-state
  - runtime: bash
    command: summarize-widget-state
receipt: [result]
attester:
  command: check-widget-state
---
Computation reference.
""",
        )
        self.assertEqual(self.verify_path(package), [])
        self.assertEqual(self.verify_path(computation), [])

    def test_reports_external_reserved_and_missing_links(self):
        body = (
            "See [external](https://example.org), [index](/index.md), "
            "and [missing](/bundle-a/missing.md)."
        )
        document = load_document(self.concept(body=body))
        as_of = datetime(2024, 1, 11, tzinfo=timezone.utc)
        messages = [
            finding.message for finding in verify(self.root, document, as_of)
        ]
        self.assertTrue(
            any("external or fragment" in message for message in messages)
        )
        self.assertTrue(
            any("untyped navigation index" in message for message in messages)
        )
        self.assertTrue(
            any("does not exist" in message for message in messages)
        )

    def test_reports_invalid_tags(self):
        path = self.concept(tags="test, test")
        document = load_document(path)
        as_of = datetime(2024, 1, 11, tzinfo=timezone.utc)
        findings = verify(self.root, document, as_of)
        messages = [finding.message for finding in findings]
        self.assertTrue(
            any(
                "missing required cluster tag" in message
                for message in messages
            )
        )
        self.assertTrue(
            any("duplicate tags" in message for message in messages)
        )


if __name__ == "__main__":
    unittest.main()


class TypedIndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.index = self.root / "topic/index.md"
        self.index.parent.mkdir()
        self.index.write_text(
            "---\ntype: Concept\ntitle: Topic\n"
            "description: Groups test concepts.\ntags: [topic, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\nTopic body.\n\n---\n\n"
            "# Contents\n\n- [Child](child.md)\n",
            encoding="utf-8",
        )
        (self.index.parent / "child.md").write_text(
            "---\ntype: Concept\ntitle: Child\n"
            "description: Child concept.\ntags: [topic, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_read_appends_contents_only_for_explicit_index(self):
        explicit = render_read(
            self.root,
            expand_read(self.root, [Path("topic")]),
        )
        child = render_read(
            self.root, expand_read(self.root, [Path("topic/child.md")])
        )
        self.assertIn("# Contents", explicit)
        self.assertNotIn("# Contents", child)
        self.assertIn("Topic body.", child)

    def test_read_accepts_navigation_index_without_frontmatter(self):
        navigation = self.root / "navigation/index.md"
        navigation.parent.mkdir()
        navigation.write_text(
            "# Navigation\n\n- [Topic](../topic/)\n",
            encoding="utf-8",
        )
        output = render_read(
            self.root,
            expand_read(self.root, [Path("navigation")]),
        )
        self.assertIn("# /navigation/index.md", output)
        self.assertIn("# Navigation", output)

    def test_read_accepts_typed_index_without_abstract(self):
        index = self.root / "empty/index.md"
        index.parent.mkdir()
        index.write_text(
            "---\ntype: Concept\ntitle: Empty\n"
            "description: Empty topic.\ntags: [empty, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n\n---\n\n# Contents\n",
            encoding="utf-8",
        )
        output = render_read(
            self.root,
            expand_read(self.root, [Path("empty")]),
        )
        self.assertIn("# /empty/index.md", output)
        self.assertIn("# Contents", output)

    def test_verify_requires_blank_lines_around_index_separator(self):
        original = self.index.read_text(encoding="utf-8")
        invalid = (
            original.replace("Topic body.\n\n---", "Topic body.\n---"),
            original.replace("---\n\n# Contents", "---\n# Contents"),
            original.replace("\n\n---\n\n", "\n"),
        )
        for text in invalid:
            with self.subTest(text=text):
                self.index.write_text(text, encoding="utf-8")
                findings = verify(
                    self.root,
                    load_document(self.index),
                    datetime(2024, 1, 11, tzinfo=timezone.utc),
                )
                self.assertTrue(
                    any(
                        "blank line before and after" in finding.message
                        for finding in findings
                    )
                )
        self.index.write_text(original, encoding="utf-8")

    def test_verify_allows_external_directory_link_in_index_abstract(self):
        external = self.root / "external/source.md"
        external.parent.mkdir()
        external.write_text(
            "---\ntype: Concept\ntitle: External\n"
            "description: External concept.\ntags: [external, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n",
            encoding="utf-8",
        )
        (external.parent / "index.md").write_text(
            "---\ntype: Concept\ntitle: External bundle\n"
            "description: External bundle.\ntags: [external, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n\n---\n\n# Contents\n",
            encoding="utf-8",
        )
        text = self.index.read_text(encoding="utf-8")
        self.index.write_text(
            text.replace("Topic body.", "See [external](../external/source.md)."),
            encoding="utf-8",
        )
        messages = [
            finding.message
            for finding in verify(
                self.root,
                load_document(self.index),
                datetime(2024, 1, 11, tzinfo=timezone.utc),
            )
        ]
        self.assertFalse(any(
            "index abstract link" in message
            or "external or fragment" in message
            for message in messages
        ))

    def test_verify_allows_same_bundle_sibling_link_in_index_abstract(self):
        branch = self.root / "topic/branch/index.md"
        branch.parent.mkdir()
        branch.write_text(
            "---\ntype: Concept\ntitle: Branch\n"
            "description: Branch topic.\ntags: [topic, branch, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n"
            "See [sibling](../sibling/source.md).\n\n---\n\n# Contents\n",
            encoding="utf-8",
        )
        sibling = self.root / "topic/sibling/source.md"
        sibling.parent.mkdir()
        sibling.write_text(
            "---\ntype: Concept\ntitle: Sibling\n"
            "description: Sibling concept.\ntags: [topic, sibling, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n",
            encoding="utf-8",
        )
        (sibling.parent / "index.md").write_text(
            "---\ntype: Concept\ntitle: Sibling topic\n"
            "description: Sibling topic.\ntags: [topic, sibling, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n\n---\n\n# Contents\n",
            encoding="utf-8",
        )
        findings = verify(
            self.root,
            load_document(branch),
            datetime(2024, 1, 11, tzinfo=timezone.utc),
        )
        self.assertFalse(any(
            "index abstract link" in finding.message
            for finding in findings
        ))

    def test_verify_rejects_own_directory_link_in_index_abstract(self):
        text = self.index.read_text(encoding="utf-8")
        self.index.write_text(
            text.replace("Topic body.", "See [child](child.md)."),
            encoding="utf-8",
        )
        findings = verify(
            self.root,
            load_document(self.index),
            datetime(2024, 1, 11, tzinfo=timezone.utc),
        )
        self.assertTrue(any(
            "index abstract link targets its own directory" in finding.message
            for finding in findings
        ))

    def test_verify_requires_each_level_directory_in_contents(self):
        nested = self.index.parent / "nested/index.md"
        nested.parent.mkdir()
        nested.write_text(
            "---\ntype: Concept\ntitle: Nested\n"
            "description: Nested topic.\ntags: [topic, nested, test]\n"
            "history:\n  created: 2024-01-01T00:00:00Z\n"
            "  updates: []\n---\n\n---\n\n# Contents\n",
            encoding="utf-8",
        )
        findings = verify(
            self.root,
            load_document(self.index),
            datetime(2024, 1, 11, tzinfo=timezone.utc),
        )
        self.assertTrue(any(
            finding.field == "contents"
            and "nested" in finding.message
            for finding in findings
        ))
