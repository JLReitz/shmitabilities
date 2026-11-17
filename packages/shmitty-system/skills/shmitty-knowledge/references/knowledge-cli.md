# Evaluate and verify knowledge

Run the launcher from the skill directory:

```bash
knowledge-cli investment <concept-path> [--root <tree-root>]
knowledge-cli confidence <concept-path> [--root <tree-root>] [-a|--all]
knowledge-cli connections <concept-path> [--root <tree-root>]
knowledge-cli verify <document-path> [<document-path> ...] [--root <tree-root>]
knowledge-cli read <document-path> [<document-path> ...] [--root <tree-root>]
knowledge-cli search [--tag <tag>]... [--type Concept|Reference] [--subtype <subtype>] [--root <tree-root>]
knowledge-cli ontology terms [--root <tree-root>]
knowledge-cli ontology facts [--root <tree-root>]
knowledge-cli ontology requirements [--root <tree-root>]
knowledge-cli migrate --root <tree-root> [--apply]
```

Check for an environment-defined root with `echo $SHMIT_KNOWLEDGE_ROOT`, if not available then `--root` must be set. An explicit `--root` takes precedence. If neither is provided, the command exits with an error.

`migrate` always requires an explicit root. Its default report lists proposed path moves, Markdown link rewrites, and ontology conflicts without changing the tree. `--apply` performs a conflict-free migration and writes `knowledge-migration-receipt.json` in the selected root with path moves, link rewrites, and ontology role counts. The operation relocates ordinary References to `sources/` and package References to `tools/`. It merges the three legacy root ontology roles into `ontology.ttl` only when their RDF triples have unambiguous roles; conflicts stop all mutation. No registered workspace tree is discovered automatically.

`investment` prints the recursive confidence, consistency, and total investment at `--as-of`. It uses the current UTC time when `--as-of` is absent.

When root `investment.connection.target` is set, `investment` also prints `fulfilled`, `open`, `qualifying_links`, `target`, and `connection`. The total includes the connection multiplier.

`ontology terms` lists each exact tag match to a defined ontology term. Columns are `concept`, `tag`, `term`, `kind`, and `match`. `match` identifies `rdfs:label` or IRI local name. `ontology facts` lists asserted and inferred triples with `subject`, `predicate`, `object`, `source`, and `link`. An asserted link fact names the authored Markdown link target, excluding structural topic table-of-contents links. `ontology requirements` lists `concept`, `class`, `property`, `filler`, `direction`, and `link`. Each explicit fulfilling link has one row; an open requirement has one row with an empty `link`. Repeated rows for one normalized requirement contribute once to `fulfilled` in investment. A distinct link that fulfills a requirement at either endpoint contributes once to `qualifying_links` for each endpoint. These commands use the root and applicable topic `ontology.ttl` modules. They check the EL and RL role views independently.

To inspect a Concept, run `verify` for structural and ontology findings, `ontology terms` for its tag matches, `ontology facts` for authored and RL facts, and `ontology requirements` for its fulfilled links and open gaps. Run `investment` for the connection counts and final score. The ontology reports cover the whole tree; use the `concept` and `link` cells to locate the relevant rows.

`verify` reasons over the whole tree and takes minutes. Do not wrap it in a short `timeout`; a killed process reports `JVM cannot be restarted`. Pass independent document paths to one command so they share one ontology snapshot and each endpoint-scoped analysis.

All commands except `read` emit tab-separated values. TSV cell values are flattened and never wrapped in backticks.

`confidence` prints the confidence of the requested concept and each concept it directly links to. Add `-a` or `--all` to print every recursively linked concept once. Investment uses the same confidence evaluation.

`connections` recursively lists authored and ontology-derived document relationships from a Concept. It follows Concepts, stops at References, and prints `depth`, `source`, `target`, `origin`, `predicate`, `basis`, `type`, and `shared_tags`. Structural containment is excluded.

`search` lists knowledge documents by exact, case-sensitive tag, top-level type, or subtype. Repeat `--tag` to require every tag. `--subtype` matches `concept_type` on Concepts and `reference_type` on References; add `--type` to limit which field it checks. Without filters, it lists all readable knowledge documents. Results include the tree-relative document path, type, subtype, tags, and title in TSV format.

When a command or inline link targets a directory, it targets that directory's `index.md`. A topic Concept is the Concept `index.md` representing a topic directory. Its abstract supplies authored links. Its table of contents serializes structural connections to immediate consumable children; those links are excluded from authored connections and ontology property assertions.

`verify` checks required metadata, topical and term tags, typed index separators, index table-of-contents coverage, body links, duplicate internal filepath declarations, Concept history, root policies, ontology files and profiles, ambiguous ontology tag matches, individual-tag uniqueness, identical explicitly declared property domain and range pairs, required ancestor indexes, Reference subtype fields, and ordinary source matches for Tool and sanctioned execution resources. Link checks recognize inline links, full, collapsed, and shortcut reference-style links, and URI and email autolinks; they ignore link-like text in backtick and tilde fenced code blocks. Each resolved internal filepath may have one inline destination or reference definition per document. Repeat a link through one reference-style definition. Concept and Reference body links reject external URLs, fragments, missing targets, non-Markdown targets, logs, and untyped navigation indexes. Reference links also reject targets outside their containing `sources/` or `tools/` hierarchy, except in an index abstract. Every index abstract accepts any consumable document outside the directory that contains the index and rejects targets in that directory or below it. Each index table of contents must link every file and child directory directly beside the index except `index.md` and `log.md`. When root `confidence.required` is `true`, verification rejects each Concept whose confidence is `0.0`. An open ontology requirement is a documentation gap in `ontology requirements` and investment; it does not invalidate the document. A clean document exits with status `0`; findings exit with status `1`.

Command errors print a description to stderr and exit with status `1`.

`read` emits each document as Markdown: a level-one tree-absolute path heading, the comma-separated tags, a Reference resource URL when applicable, and the body. For each Reference, it first emits the required `index.md` documents from the domain directory through the Reference's parent directory. For each Concept, it first emits the required concept indexes from the topic through the Concept's parent directory. Each ancestor index is emitted once per command without its table of contents. An explicitly targeted index includes its table of contents and remains readable when its frontmatter or abstract is missing.
