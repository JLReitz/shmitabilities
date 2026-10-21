# Shmitty Knowledge

`shmitty-knowledge` maintains a portable tree of Markdown knowledge documents. It separates
source-faithful **References** from **Concepts** that explain, connect, or interpret them. The tree
remains readable in a text editor, while `knowledge-cli` searches it, follows its links, checks its
rules, and measures support for its concepts.

The design is based on the [Open Knowledge Format (OKF) v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)
and is backward compatible with its core document model: UTF-8 Markdown, YAML frontmatter, directory
hierarchy, and standard Markdown links. An OKF reader can read ordinary Shmitty knowledge documents
and preserve their extra fields. Shmitty verification applies additional rules, so an arbitrary OKF
tree does not necessarily pass it. Typed `index.md` files extend OKF's untyped index convention and
need special handling in a reader that enforces that convention. OKF's optional provenance, trust,
and lifecycle fields remain valid extra metadata; Shmitty calculates its own confidence and
investment from citations and revision history.

## Tree and documents

A tree is the unit of distribution. Subject directories group Concepts into topics; `references/`
groups References by source domain and meaningful source boundary. A top-level subject directory is
a bundle, and links may connect Concepts across bundles within the same tree.

```text
<tree-root>/
  index.md
  vocabulary.ttl
  requirements.ttl
  axioms.ttl
  references/
    index.md
    <domain>/
      index.md
      <source>.md
  <bundle>/
    index.md
    <concept>.md
    <subtopic>/
      index.md
      <concept>.md
    log.md
```

Each knowledge document has YAML frontmatter with `type`, `title`, `description`, and unique,
case-sensitive `tags`. Its `type` is `Concept` or `Reference`; `concept_type` and `reference_type`
name more specific kinds without changing those top-level classes. Tags include every parent
directory name as a topical tag and at least one other term tag. Timestamps use ISO 8601 with an explicit UTC offset.
Producers may add fields, and consumers preserve fields they do not recognize.

A document ID is its path relative to the tree root, without `.md`. Directories resolve to their
`index.md` when used as command targets or links.

## References and Concepts

A **Reference** describes one persistent external resource in the source's own terms. Its
frontmatter adds a canonical HTTP or HTTPS `resource`, a `resource_type`, and a `timestamp` for the
source's last change or, when that is unavailable, the observation time. A non-index Reference
contains the contracts, field meanings, constraints, procedures, and templates needed to use the
source without web access. Source code at a release tag or commit can support code-defined
contracts. Search results, command output, receipts, previews, and logs remain working evidence;
the persistent source becomes the Reference.

An ordinary source Reference is unique per normalized resource URL in a tree. Normalization folds
scheme and host case and removes fragments while retaining content-selecting query parameters.
When a source already has a Reference, revise that document. References can link only to other
References under `references/`, except for links in an index abstract.

A **Concept** contains analysis, decisions, or other knowledge supported by References and linked
Concepts. Place a link near the claim it supports; use a Markdown footnote when repeated
attribution needs a clearer target. A Concept can cite every Reference subtype. It records
`history.created` and ordered `history.updates` timestamps for meaningful revisions. An unanswered
question is an open Concept with a valid frontmatter and an empty body. When credible sources
support positions that remain in conflict, give each position a separate linked Concept and keep
the questions needed to resolve the conflict open.

Concept and Reference body links resolve to typed knowledge documents in the same tree. They use
standard Markdown paths rooted at `/`; external URLs belong in Reference `resource` fields.
Fragments, missing targets, non-Markdown files, logs, and untyped navigation indexes are invalid
body targets. A document declares each resolved target path once; repeated uses share one
reference-style link definition.

## Typed indexes and logs

Each Concept topic, source directory, and package directory has a typed `index.md`. Its frontmatter
and abstract make it a readable Concept or Reference. A horizontal separator divides the abstract
from a table of contents that links every adjacent file and child directory except `index.md` and
`log.md`. The table of contents uses relative paths and short descriptions. An abstract may link to
a typed document outside its own directory subtree; local children belong in the table of contents.
Source directory abstracts identify the complete domain, website, guide, repository, or database
represented beneath them. A Concept topic index has implicit connections to its direct child
documents and child topic indexes.

The tree root `index.md`, `references/index.md`, and `references/packages/index.md` contain policy
and navigation rather than knowledge claims. A directory's `log.md` records changes in descending
ISO date groups. These support files are not citation targets.

## Ontology terms and connections

The required root Turtle files give ontology statements distinct roles. `vocabulary.ttl` declares
shared classes, properties, named individuals, labels, and hierarchies. `requirements.ttl` defines
OWL 2 EL existence requirements. `axioms.ttl` defines OWL 2 RL inference rules. Each file may be
empty. The CLI checks vocabulary with requirements against EL and vocabulary with axioms against
RL. The root index sets only the optional `investment.connection.target`; it does not list ontology
files. The three Turtle files are support files, so the root table of contents omits them. The
self-contained tree requires terms to be present in these files; the CLI rejects `owl:imports`.

A Concept's authored tags match ontology terms by exact, case-sensitive `rdfs:label` first and IRI
local name second. This includes topical tags and tags that match named individuals. An ambiguous
match is a verification error. The CLI derives property facts only from explicit directed Concept
body links whose endpoint terms match a defined property relationship. Index table-of-contents
links provide navigation and do not assert ontology relationships. It reports RL-derived facts
separately. A derived inverse or property-chain fact does not supply a missing authored link.

Each applicable EL existence requirement asks for at least one explicit Concept link in the
property's direction. A same-direction subproperty or equivalent property qualifies. Equivalent
and implied requirements are counted once. An open requirement is a documentation gap; `verify`
still accepts the Concept. `ontology requirements` reports a row with an empty `link` for the gap
and one row per fulfilling link when it is satisfied. `ontology terms` and `ontology facts` expose
the matches and assertions that explain the result. The full command and column contract is in
[Evaluate and verify knowledge](../../skills/shmitty-knowledge/references/knowledge-cli.md).

The requirement extractor accepts object existential restrictions with named properties,
including anonymous conjunction sources, nested existential fillers, and an individual named by
`owl:hasValue`. It reports an error for EL class expressions that the document-link requirement
model cannot interpret, including data restrictions and self restrictions. OWL API still checks
the complete authored EL role profile before extraction.

The acceptance fixture uses the published [W3C SOSA ontology](https://www.w3.org/ns/sosa/)
retrieved as Turtle on 2026-10-21. Its local `axioms.ttl` copy has trailing
whitespace removed and SHA-256
`e50ebca51aa4af6d11d281e32c6c6101a74e9fa76792eeae6b0f3aae00aa683b`.
The ontology declares W3C and OGC software licenses. A shared vocabulary selects its Sensor,
Observation, and relationship terms; a small authored EL companion adds a documentation
requirement that SOSA itself does not assert. The test checks an explicit Sensor to Observation
link and the inverse fact inferred from SOSA.

## Package and execution References

`reference_type: Package` gives a package its own `references/packages/<package>/index.md`.
Its abstract identifies the tools and their purpose and records inspected host installation,
state, cache, data, logs, configuration precedence, persistent settings, privileges, services,
environment, command resolution, and update behavior. Source-defined behavior and observed host
state have separate headings. Package-scoped execution References reside under that directory.

`reference_type: Command` defines one reproducible command pattern. Its metadata declares the
runtime, command, typed arguments, receipt fields, and attester command. A Computation
(`reference_type: Computation`) defines a process with a managed virtual environment and at least
two command components; its body defines execution order, parallelism, bindings, dependencies, and
receipt collection. Each execution Reference describes success, errors, partial effects, receipt
shapes, and the attester's checks. The receipt and verdict remain outside the tree after execution.
A Package, Command, or Computation `resource` matches an ordinary source Reference's normalized
URL.

See [Packages](../../skills/shmitty-knowledge/references/packages.md) and
[Sanctioned executions](../../skills/shmitty-knowledge/references/sanctioned-executions.md) for
their field contracts.

## Confidence and investment

Confidence measures a Concept's support. Direct Reference links cover the Concept's authored term
tags that they share by exact original text. The union of covered tags divided by all term tags
gives **citation coverage**. Directory ancestor tags are topical tags and do not count in citation
coverage. Linked Concepts
contribute their average recursive confidence. When both inputs are positive, confidence averages
them; when only one is positive, it uses that input. Evaluation caches completed Concepts and
excludes a link back to a Concept currently being evaluated, so cycles terminate. An open Concept
may have zero confidence; a populated Concept needs positive support. A topic index may gain
confidence through its implicit child connections.

**Consistency** estimates the probability that a Concept needs no meaningful revision during a
chosen horizon. It uses the time since `history.created`, the count of `history.updates`, and a
tree-wide Gamma-Poisson policy with `time_unit`, `alpha`, `beta`, and `horizon`. **Investment** is
confidence multiplied by consistency. The root index stores this policy alongside
`knowledge_format_version: "1.0"`; `confidence.required: true` makes zero confidence for a
populated Concept a verification error. These scores guide review; they do not replace reading
the cited claims and sources.

```text
confidence = citation coverage + average recursive linked-concept confidence
if both inputs are positive, confidence = confidence / 2
consistency = ((beta + exposure) / (beta + exposure + horizon)) ^ (alpha + updates)
investment = confidence * consistency
when investment.connection.target is set:
  coverage = F / (F + G), or 1 when F + G = 0
  breadth = (F + Q) / (F + Q + max(T - Q, 0))
  connection = coverage * breadth
  investment = confidence * consistency * connection
```

`exposure` is the elapsed time from creation in the configured time unit; `updates` counts
meaningful revisions through the evaluation time. The root policy accepts `second`, `minute`,
`hour`, or `day` and positive `alpha`, `beta`, and `horizon` values. `beta` and `horizon` use the
same unit. See [Knowledge Format](../../skills/shmitty-knowledge/SKILL.md) for the exact schema.

`F` counts fulfilled normalized existence requirements, `G` counts open ones, `Q` counts distinct
explicit Concept links incident to the Concept that fulfill a requirement at either endpoint,
and `T` is the positive integer root `investment.connection.target`. A requirement needs an
explicit link in its property's direction from the Concept to count as fulfilled. When the target
is set, the connection multiplier applies to every Concept. It reaches `1` when `Q >= T` and
`G = 0`, including Concepts with no requirements. Without the target, investment uses confidence
and consistency alone.

## Working with the tree

`knowledge-cli search` selects documents by exact tags, top-level type, and subtype. `read` shows
the requested document with ancestor topic or source abstracts; `connections` follows Concept
links recursively and stops at References. `confidence` and `investment` report the support and
review scores. `verify` checks metadata, source identity, tags, history, indexes, links, subtype
contracts, and the optional confidence gate. The CLI uses `SHMIT_KNOWLEDGE_ROOT` or an explicit
`--root`. `read` emits Markdown; the other commands emit tab-separated values.

Use [Evaluate and verify knowledge](../../skills/shmitty-knowledge/references/knowledge-cli.md)
for command syntax, [Use knowledge](../../skills/shmitty-knowledge/references/use-knowledge.md)
to read claims, and [Add knowledge](../../skills/shmitty-knowledge/references/add-knowledge.md)
to author documents. Use
[Maintain knowledge](../../skills/shmitty-knowledge/references/maintain-knowledge.md) to revise
them. Edit the skill source in this repository when changing its rules. Validate the affected
component with [Validation](../validation.md).
