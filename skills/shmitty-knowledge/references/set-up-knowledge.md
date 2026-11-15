# Set up knowledge

1. Choose one directory as the knowledge root. Keep its path available for `--root <tree-root>` when running `knowledge-cli`.
2. Create `index.md` in that directory with the frontmatter example below. Choose the consistency values for this tree. Leave the navigation body ready to link new topics and source domains.
3. Create `ontology.ttl` at the root. Start with the prefixes and Shared vocabulary that apply throughout the tree. Use `@prefix sk: <urn:shmitty:knowledge:> .` when the module uses `sk:role` or `sk:plainTag`. An empty Turtle module is sufficient until the first topic needs shared terms.
4. Create `sources/index.md` and `tools/index.md` as navigation documents. Add their contents links when source domains and tools are added. Keep ontology modules out of these directories.
5. Create the first topic when there is knowledge to place. Add `<topic>/index.md` as a Topic Concept with a `topic_tag` in its tags, and add `<topic>/ontology.ttl` declaring the matching class. Give the class a meaningful axiom or requirement. Add the topic to the root navigation, then follow [Add knowledge](add-knowledge.md) for its Concepts and References.
6. Run `scripts/knowledge-cli ontology terms --root <tree-root>` from the skill directory to check that the root ontology loads. Run `scripts/knowledge-cli verify <document-path> --root <tree-root>` for each new knowledge document. Use [Evaluate and verify knowledge](knowledge-cli.md) for the remaining checks.

The initial tree has this shape:

```text
<tree-root>/
  index.md
  ontology.ttl
  sources/
    index.md
  tools/
    index.md
```

Start `index.md` with this frontmatter:

```yaml
---
knowledge_format_version: "1.0"
investment:
  consistency:
    model: gamma-poisson
    time_unit: day
    alpha: 1.0
    beta: 365.0
    horizon: 30.0
---
```

The consistency fields are required policy choices; the numbers above are starter values, not implicit defaults. Omitting `confidence.required` gives `false`. Omitting `ontology.term_tags` disables unmatched-tag reporting. Omitting `investment.connection` disables connection investment. Add these optional fields when the tree needs their behavior.

The root `index.md`, `sources/index.md`, and `tools/index.md` are support documents. A topic index, source-domain index, or tool index becomes a knowledge document when its directory is created.
