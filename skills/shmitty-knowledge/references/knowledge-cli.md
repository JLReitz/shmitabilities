# Evaluate and verify knowledge

Run the launcher from the skill directory:

```bash
scripts/knowledge-cli investment <concept-path> [--root <tree-root>]
scripts/knowledge-cli confidence <concept-path> [--root <tree-root>] [-a|--all]
scripts/knowledge-cli connections <concept-path> [--root <tree-root>]
scripts/knowledge-cli verify <document-path> [--root <tree-root>]
scripts/knowledge-cli read <document-path> [<document-path> ...] [--root <tree-root>]
scripts/knowledge-cli search [--tag <tag>]... [--type Concept|Reference] [--subtype <subtype>] [--root <tree-root>]
```

Check for an environment-defined root with `echo $SHMIT_KNOWLEDGE_ROOT`, if not available then `--root` must be set. An explicit `--root` takes precedence. If neither is provided, the command exits with an error.

`investment` prints the recursive confidence, consistency, and total investment at `--as-of`. It uses the current UTC time when `--as-of` is absent.

All commands except `read` emit tab-separated values. TSV cell values are flattened and never wrapped in backticks.

`confidence` prints the confidence of the requested concept and each concept it directly links to. Add `-a` or `--all` to print every recursively linked concept once. Investment uses the same confidence evaluation.

`connections` recursively lists each internal knowledge-document link from a concept. It follows concept links, stops at references, and prints each link's document type and tags shared with the requested concept.

`search` lists knowledge documents by exact, case-sensitive tag, top-level type, or subtype. Repeat `--tag` to require every tag. `--subtype` matches `concept_type` on Concepts and `reference_type` on References; add `--type` to limit which field it checks. Without filters, it lists all readable knowledge documents. Results include the tree-relative document path, type, subtype, tags, and title in TSV format.

When a command or inline link targets a directory, it targets that directory's `index.md`. A Concept `index.md` also has implicit connections to every consumable child document and child topic index in its directory.

`verify` checks required metadata, cluster and topical tags, typed index separators, index table-of-contents coverage, body links, duplicate internal filepath declarations, Concept history, root policies, required ancestor indexes, Reference subtype fields, and ordinary source matches for Package and sanctioned execution resources. Link checks recognize inline links, full, collapsed, and shortcut reference-style links, and URI and email autolinks; they ignore link-like text in backtick and tilde fenced code blocks. Each resolved internal filepath may have one inline destination or reference definition per document. Repeat a link through one reference-style definition. Concept and Reference body links reject external URLs, fragments, missing targets, non-Markdown targets, logs, and untyped navigation indexes. Reference links also reject targets outside the tree-root `references/` directory, except in an index abstract. Every index abstract accepts any consumable document outside the directory that contains the index and rejects targets in that directory or below it. Each index table of contents must link every file and child directory directly beside the index except `index.md` and `log.md`. When root `confidence.required` is `true`, verification rejects each non-open Concept whose confidence is `0.0`. A clean document exits with status `0`; findings exit with status `1`.

Command errors print a description to stderr and exit with status `1`.

`read` emits each document as Markdown: a level-one tree-absolute path heading, the comma-separated tags, a Reference resource URL when applicable, and the body. For each Reference, it first emits the required `index.md` documents from the domain directory through the Reference's parent directory. For each Concept, it first emits the required concept indexes from the bundle through the Concept's parent directory. Each ancestor index is emitted once per command without its table of contents. An explicitly targeted index includes its table of contents and remains readable when its frontmatter or abstract is missing.
