# Knowledge structure

A knowledge root is the filesystem boundary of one knowledge tree. Markdown knowledge documents are graph nodes. A directed document link is a connection. The filesystem still supplies the storage hierarchy and the immediate containment relationship of each topic.

```text
knowledge root
├── index.md             navigation and policy
├── ontology.ttl         shared ontology module
├── sources/             source faithful References
│   └── <domain>/index.md
├── tools/               Tool, Command, and Computation References
│   └── <tool>/index.md
└── <topic>/             Concept hierarchy
    ├── index.md         topic Concept
    ├── ontology.ttl     topic ontology module
    └── <concept>.md
```

The Topic Concept at `<topic>/index.md` describes the topic in its abstract. Its table of contents lists each immediate consumable child. The filesystem defines a structural connection from that Topic Concept to each child; the table of contents is the readable serialization of that set. The CLI verifies exact membership. A malformed immediate Markdown child is reported rather than silently omitted. Ontology files, logs, and navigation indexes are support artifacts, not graph nodes.

`read` adds ancestor abstracts for a requested Concept or Reference. For References, the ancestors come from the containing `sources/` or `tools/` hierarchy. `connections` follows authored and ontology-derived document relationships through Concepts and stops at References. Its rows expose depth, source, target, origin, predicate, basis, type, and shared tags. Structural containment stays internal to operations that use context, requirements, confidence, or investment. A qualifying immediate structural child can fulfill a Topic Concept's connection requirement and raise its investment, while the child receives no corresponding structural contribution. Ontology facts remain available in the ontology report.

The path relative to the knowledge root identifies a document. Moving an ordinary Reference from `references/` to `sources/`, or a tool Reference to `tools/`, changes that path ID while preserving the Reference's semantic type, subtype, resource, and content. Explicit root migration rewrites incoming links and records the mapping. Repository examples use the new paths; existing trees require that migration before the new layout is validated.

## Explicit root migration

`knowledge-cli migrate --root <tree-root>` reports the proposed file moves, Markdown link rewrites, and ontology conflicts without changing the tree. Adding `--apply` stages the result in a temporary copy, validates the converted ontology, then applies it to the selected root and writes `knowledge-migration-receipt.json` there. The receipt records path moves, rewritten documents, ontology role counts, and whether the ontology was converted. The operation refuses a reviewed plan if the tree changed before application. A failed final check restores the changed paths from a temporary backup. The command does not search registered workspaces for other trees.

The migration moves ordinary References from `references/` to `sources/` and package References from `references/packages/` to `tools/`. It rewrites active incoming Markdown links, including relative links from moved documents. The three legacy root ontology files become one role-annotated root `ontology.ttl` when each axiom has one clear role. Existing topic modules are left in place; the operation does not infer which root axioms belong in particular topics. A conflicting axiom role or destination path stops the migration before mutation. The resulting tree has no path aliases or legacy ontology files.

## Topic modeling workflow

Start a topic by creating its Concept `index.md` and local `ontology.ttl`. The index's `topic_tag` names one class declared in that module. A nested topic class has a Shared subclass axiom pointing to its immediate parent topic class. Give every Concept at least one tag that matches a class, property, or named individual in its effective ontology. Ontology terms match by exact label, then IRI local name; a repeated `sk:plainTag` annotation on the ontology declares an intentional retrieval-only tag. The root index's `ontology.term_tags` setting selects required errors, warnings, or no unmatched-tag check.

Give a class a meaningful axiom or requirement when it changes inference or documentation obligations. Use a plain tag for a retrieval category without those effects. Model an unanswered relationship question as an open existence requirement: the missing fulfilling connection appears in `ontology requirements` and reduces connection investment. Creating a placeholder Concept for the missing answer would instead satisfy the requirement and hide the gap.

The CLI evaluates each Concept against the root and its ancestor topic modules. For a relationship between Concepts, the directly participating endpoints select the ontology views. Shared axioms enter both profile checks; Requirement axioms enter the OWL 2 EL view; Inference axioms enter the OWL 2 RL view. Authored Concept links can assert property facts. Derived facts can appear in `connections` with their origin and basis, while structural topic children remain separate and can contribute only to the parent topic's investment.

## Distributed ontology

The root index selects unmatched tag reporting through `ontology.term_tags`:
`required` makes unmatched term tags verification errors, `warn` reports them
as warnings, and an omitted value disables that report. Ontology terms match
first by label, then by IRI local name. A vocabulary ontology can annotate
intentional plain tags with repeated `sk:plainTag` string literals using
the `sk:` prefix mapped to `urn:shmitty:knowledge:`; plain tags are considered after
ontology terms. A Concept still needs at least one ontology term tag even when
unmatched tag reporting is disabled.

`ontology.ttl` at the root supplies shared terms across the tree. A topic's
`ontology.ttl` adds terms and axioms for that topic and its descendants. The
CLI selects modules by the endpoint documents' containing topics; an authored
link joins only the effective ontologies of its two endpoints. It never loads
unrelated sibling modules or follows `owl:imports`.

Entity declarations and labels enter both views as Shared vocabulary. Each
other logical Turtle axiom has an `owl:Axiom` annotation with
`sk:role` set to `Shared`, `Requirement`, or
`Inference`. The loader puts Shared axioms in both reasoning views, joins
Requirement axioms for OWL 2 EL checks, and joins Inference axioms for OWL 2 RL
checks. RDF list and restriction triples travel with their annotated axiom.
Repeated axioms keep the same role across modules; a conflicting role stops
validation. The source path remains available in conflict diagnostics.

The `topic_tag` frontmatter field designates a topic Concept's class. That
class is declared in the topic's own module. Nested topic classes have an
authored Shared subclass relationship to their immediate parent topic class.
Top-level topics have no parent class because the root index is navigation and
policy rather than a topic Concept.

Ontology validation uses the Python RDF and OWL packages and the packaged
HermiT JAR. [Ontology dependencies](dependencies.md#knowledge-ontology-tooling)
lists installation and verification commands.

The CLI is implemented in `packages/shmitty-system/bin/knowledge_cli/`. Its focused filesystem tests are in `packages/shmitty-system/bin/tests/test_structure.py`. Install [ontology tooling](dependencies.md#knowledge-ontology-tooling), then run `python3 -m unittest discover -s packages/shmitty-system/bin/tests -p 'test_structure.py'` from the repository root to validate topic contents, connection traversal, and source and tool ancestor context.
