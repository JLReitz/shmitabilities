# Evaluate and verify knowledge

Run the launcher from the skill directory:

```bash
scripts/knowledge-cli investment <concept-path> [--root <tree-root>]
scripts/knowledge-cli confidence <concept-path> [--root <tree-root>] [-a|--all]
scripts/knowledge-cli connections <concept-path> [--root <tree-root>]
scripts/knowledge-cli verify <document-path> [--root <tree-root>]
scripts/knowledge-cli read <document-path> [<document-path> ...] [--root <tree-root>]
scripts/knowledge-cli search [--tag <tag>]... [--type Concept|Reference] [--subtype <subtype>] [--root <tree-root>]
scripts/knowledge-cli ontology terms [--root <tree-root>]
scripts/knowledge-cli ontology facts [--root <tree-root>]
scripts/knowledge-cli ontology requirements [--root <tree-root>]
```

Check for an environment-defined root with `echo $SHMIT_KNOWLEDGE_ROOT`, if not available then `--root` must be set. An explicit `--root` takes precedence. If neither is provided, the command exits with an error.

`investment` prints the recursive confidence, consistency, and total investment at `--as-of`. It uses the current UTC time when `--as-of` is absent.

When root `investment.connection.target` is set, `investment` also prints `fulfilled`, `open`, `qualifying_links`, `target`, and `connection`. The total includes the connection multiplier.

`ontology terms` lists each exact tag match to a defined ontology term. Columns are `concept`, `tag`, `term`, `kind`, and `match`. `match` identifies `rdfs:label` or IRI local name. `ontology facts` lists asserted and inferred triples with `subject`, `predicate`, `object`, `source`, and `link`. An asserted link fact names the authored Markdown link target, including one in a topic Concept's table of contents. `ontology requirements` lists `concept`, `class`, `property`, `filler`, `direction`, and `link`. Each explicit fulfilling link has one row; an open requirement has one row with an empty `link`. Repeated rows for one normalized requirement contribute once to `fulfilled` in investment. A distinct link that fulfills a requirement at either endpoint contributes once to `qualifying_links` for each endpoint. These commands require `vocabulary.ttl`, `requirements.ttl`, and `axioms.ttl` at the knowledge root. They check the EL and RL roles independently.

To inspect a Concept, run `verify` for structural and ontology findings, `ontology terms` for its tag matches, `ontology facts` for authored and RL facts, and `ontology requirements` for its fulfilled links and open gaps. Run `investment` for the connection counts and final score. The ontology reports cover the whole tree; use the `concept` and `link` cells to locate the relevant rows.

All commands except `read` emit tab-separated values. TSV cell values are flattened and never wrapped in backticks.

`confidence` prints the confidence of the requested concept and each concept it directly links to. Add `-a` or `--all` to print every recursively linked concept once. Investment uses the same confidence evaluation.

`connections` recursively lists each internal knowledge-document link from a concept. It follows concept links, stops at references, and prints each link's document type and tags shared with the requested concept.

`search` lists knowledge documents by exact, case-sensitive tag, top-level type, or subtype. Repeat `--tag` to require every tag. `--subtype` matches `concept_type` on Concepts and `reference_type` on References; add `--type` to limit which field it checks. Without filters, it lists all readable knowledge documents. Results include the tree-relative document path, type, subtype, tags, and title in TSV format.

When a command or inline link targets a directory, it targets that directory's `index.md`. A topic Concept is the Concept `index.md` representing a topic directory. Its abstract and table of contents together supply explicit links for connections and ontology assertions. It also has implicit connections to every consumable child document and child topic Concept in its directory.

`verify` checks required metadata, topical and term tags, typed index separators, index table-of-contents coverage, body links, duplicate internal filepath declarations, Concept history, root policies, ontology files and profiles, ambiguous ontology tag matches, required ancestor indexes, Reference subtype fields, and ordinary source matches for Package and sanctioned execution resources. Link checks recognize inline links, full, collapsed, and shortcut reference-style links, and URI and email autolinks; they ignore link-like text in backtick and tilde fenced code blocks. Each resolved internal filepath may have one inline destination or reference definition per document. Repeat a link through one reference-style definition. Concept and Reference body links reject external URLs, fragments, missing targets, non-Markdown targets, logs, and untyped navigation indexes. Reference links also reject targets outside the tree-root `references/` directory, except in an index abstract. Every index abstract accepts any consumable document outside the directory that contains the index and rejects targets in that directory or below it. Each index table of contents must link every file and child directory directly beside the index except `index.md` and `log.md`. When root `confidence.required` is `true`, verification rejects each non-open Concept whose confidence is `0.0`. An open ontology requirement is a documentation gap in `ontology requirements` and investment; it does not invalidate the document. A clean document exits with status `0`; findings exit with status `1`.

Command errors print a description to stderr and exit with status `1`.

`read` emits each document as Markdown: a level-one tree-absolute path heading, the comma-separated tags, a Reference resource URL when applicable, and the body. For each Reference, it first emits the required `index.md` documents from the domain directory through the Reference's parent directory. For each Concept, it first emits the required concept indexes from the bundle through the Concept's parent directory. Each ancestor index is emitted once per command without its table of contents. An explicitly targeted index includes its table of contents and remains readable when its frontmatter or abstract is missing.
