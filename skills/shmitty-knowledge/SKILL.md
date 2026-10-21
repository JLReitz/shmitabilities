---
name: shmitty-knowledge
description: Use, add to, and maintain a self-contained Open Knowledge Format knowledge tree of source-faithful references and cited concepts.
allowed-tools: Bash(scripts/knowledge-cli:*)
---

# Knowledge Format

This format stores knowledge as UTF-8 Markdown files with YAML frontmatter. A knowledge tree is one unit of distribution and can contain cross-linked bundles.

## Terms

- **Tree root**: The top directory of a knowledge tree and the boundary for knowledge-document paths.
- **Topic**: A Concept `index.md` or its parent directory.
- **Package**: A Package Reference `index.md` or its parent directory.
- **Source**: A standard Reference `index.md` or its parent domain.
- **Bundle**: A top-level subject directory within a knowledge tree that contains related concepts and support documents.
- **Knowledge document**: A `Reference` or `Concept` Markdown file.
- **Reference**: A source-faithful document about one external resource.
- **Resource**: The external source identified by a reference document's `resource` URL.
- **Concept**: Analysis or knowledge supported by references or linked concepts.
- **Open concept**: A known knowledge gap represented by a concept with an empty body.
- **Citation**: A concept-to-reference link with a declared support level.
- **Document ID**: The tree-relative document path without the `.md` suffix.

## Bundle structure

Organize concepts by subject. Organize references first by source domain and then by meaningful source boundaries such as a website, webpage, repository, or database. Place package abstracts and package-scoped sanctioned executions under `references/packages/<package>/`; place other sanctioned executions under their resource domains.

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
      <source>/
        index.md
        <contained-source>.md
  <bundle>/
    index.md
    log.md
    <concept>.md
    <subtopic>/
      index.md
      <concept>.md
```

Every source domain and package directory below `references/` MUST contain `index.md` with Reference frontmatter, an abstract, a horizontal separator, and a table of contents. Set its `resource` to the persistent source represented by the entire directory. A domain directory's abstract identifies the domain root. A nested directory's abstract identifies the complete website, guide, repository, database, or other source whose contained resources appear below it.

Use `<source>.md` when one document represents the source. Use `<source>/index.md` when the source contains separately referenced sources. Model source boundaries by meaning, not by splitting each URL path segment into a directory.

The reserved filenames are:

| Filename | Meaning |
|---|---|
| `index.md` | Concept topic, Package, or standard Reference abstract followed by a horizontal separator and a table of contents. |
| `log.md` | Chronological update history. |

`index.md` is a consumable `Concept` or `Reference` knowledge document according to its tree location. The root `index.md`, `references/index.md`, `references/packages/index.md`, and `log.md` are support documents.

## Ontology files

Every knowledge root contains `vocabulary.ttl`, `requirements.ttl`, and
`axioms.ttl`. Empty files are valid. Define shared ontology terms in
`vocabulary.ttl`, EL existence requirements in `requirements.ttl`, and RL
inference axioms in `axioms.ttl`. The CLI checks vocabulary plus requirements
against OWL 2 EL and vocabulary plus axioms against OWL 2 RL. Keep generated
tag and link assertions separate from these authored files. The root table of
contents omits the Turtle support files.

Authored tags match ontology terms by exact, case-sensitive `rdfs:label` first
and IRI local name second. Match topical tags too. Named individuals use the
same rule. Ambiguous names are verification errors. Explicit Concept body links
assert matching directed property relationships. RL facts can add class and
property context; inverse and chain-derived facts do not fulfill a required
authored link. Report requirements with `knowledge-cli ontology requirements`.
An open requirement affects connection investment and does not invalidate a
Concept.

## Knowledge documents

Every knowledge document starts with parseable YAML frontmatter and contains a non-empty `type`. Use only `Reference` and `Concept` as the top-level document classes. Use `reference_type` or `concept_type` when a document needs a more specific kind.

```yaml
---
type: Concept
concept_type: Metric
title: Completed customer orders
description: Defines a completed customer order across sales channels.
tags: [commerce, sales, orders]
history:
  created: 2026-09-19T12:00:00-07:00
  updates: []
---
```

All timestamp values use ISO 8601 datetimes with an explicit UTC offset.

### Common fields

| Field | Requirement | Meaning |
|---|---|---|
| `type` | Required | `Reference` or `Concept`. |
| `title` | Required | Human-readable display name. |
| `description` | Required | One sentence that identifies the document's knowledge. |
| `tags` | Required | Unique, case-sensitive strings containing every parent-directory name as a topical tag and at least one other term tag. |

Producers can add fields. Consumers preserve unknown fields when they rewrite a document and accept unknown values in extension fields such as `reference_type` and `concept_type`.

Use structural Markdown such as headings, lists, tables, and fenced code blocks. No body heading is required. `# Schema`, `# Examples`, and `# Computation` have their plain meanings.

## References

A reference documents one external source without analysis. Its body states only information present in that source. Create a concept for comparisons, deductions, recommendations, or synthesis.

Write every non-index Reference, including Command and Computation, for a reader without web access. Include the source-defined contracts, field meanings, constraints, procedures, and complete formatted templates needed to apply its subject. Put abstracts only in `index.md` bodies. Use online source code at a release tag or commit as the resource for code-defined contracts. When resource access is available, verify the reference against its `resource`, correct or refine its body, and update its timestamp when the source changes. When access is unavailable, preserve the last verified content and do not claim a new verification.

Capture only persistent sources as references. Command output, operational logs, receipts, search results, generated previews, temporary files, and other ephemeral artifacts are evidence rather than knowledge material. Follow a search result to its persistent source and reference that source.

Keep repository-specific implementation findings in the source repository and session memory. A published source file may support a Reference when its online version is the declared `resource`.

Reference frontmatter also requires:

| Field | Meaning |
|---|---|
| `resource` | Persistent absolute canonical HTTP or HTTPS URL of the documented source. |
| `resource_type` | Source kind, such as `Webpage`, `Repository`, `Database`, `Image`, or `Video`. |
| `timestamp` | Time when the external source last changed. |

Set `timestamp` to the source's last-modified time. When that time is unavailable, use the time the source was observed. Keep timestamp provenance and fallback notes out of the source-faithful reference body.

One tree contains at most one ordinary source reference for a given normalized `resource` URL. Every Package and sanctioned execution `resource` MUST match the normalized `resource` of an ordinary source Reference. Packages and sanctioned executions MAY share that URL. Normalize scheme and host casing, remove fragments, and preserve query parameters that select distinct content. A resource collision between ordinary source references means the existing reference is the update target. Keep source-faithful detail in that reference and move analysis to a concept.

Every parent-directory name between a Reference and the knowledge root is a required topical tag. At least one additional term tag is required. Topical tags identify progressively narrower groups as the tree deepens; they do not represent source coverage.

```yaml
---
type: Reference
title: Widget API guide
description: Describes authentication and request limits for the Widget API.
tags: [widget, api]
resource: https://docs.example.com/widget-api
resource_type: Webpage
timestamp: 2026-09-18T20:15:00Z
---
```

### Packages

Read [packages](references/packages.md) to understand `package` reference types.

### Sanctioned executions

Read [Sanctioned executions](references/sanctioned-executions.md) for `Command` and `Computation` reference subtypes and the attestation procedure.

## Concepts

A concept combines supported claims into useful knowledge. Its body links are its evidence and relationships.

A Concept MAY link to any document whose top-level `type` is `Reference`, including an ordinary source Reference and the `Package`, `Command`, and `Computation` subtypes. `reference_type` does not change linkability, evidence treatment, or path rules.

Every parent-directory name between a Concept and the knowledge root is a required topical tag. At least one additional term tag is required. A tag exactly equal to any parent-directory name is always a topical tag and never contributes to citation coverage.

Every Concept topic directory contains an `index.md` Concept. The index is implicitly connected to every consumable child document and each child topic's `index.md` in its directory. These implicit links behave like body links: recursive collection follows Concepts and stops at References.

Every direct body link whose resolved target has `type: Reference`, including `index.md` and every Reference subtype, counts as local evidence. For each linked Reference, the original-text tags it shares with the Concept cover those term tags. Citation coverage is the size of the union of all covered term tags divided by the Concept's total number of term tags. Linked Concepts contribute through recursive confidence.

Use prose near each link to identify the claim it supports. Use Markdown footnotes when claim-level attribution is repeated or would otherwise be ambiguous; keep the footnote target as the reference document path.

An open concept has valid frontmatter and an empty body. Only an open concept may have confidence `0.0`; implicit child connections can give an open topic index positive confidence. Every non-open Concept MUST have positive confidence from direct Reference coverage, linked Concepts, or both.

Concept frontmatter also requires `history`:

```yaml
history:
  created: 2024-01-15T09:00:00Z
  updates:
    - 2024-06-03T17:20:00Z
    - 2025-02-12T11:45:00Z
```

`created` begins authoritative revision tracking. Append one timestamp to `updates` for each later meaningful revision. Keep update timestamps ordered oldest to newest. Cosmetic edits do not add updates.

### Conflicting evidence

When credible evidence supports positions that do not converge in the current task context, model each position as a separate Concept or topic. State the scope of each position, cite its supporting References, and link the related position Concepts. Keep the positions distinct while the conflict remains unresolved in that context.

Create an open Concept for each unanswered question needed to resolve the conflict. Link the relevant position Concepts to each open Concept; keep the open Concept body empty until evidence supports an answer.

## Links and paths

A Concept link MAY cross bundle boundaries within the tree. A Reference link MUST remain within the tree-root `references/` directory, except in an index abstract. Use standard Markdown links with tree-absolute paths beginning with `/`.

```markdown
See the [API reference](/references/example.com/api.md).
```

A link states a directed relationship. The surrounding prose names the relationship. Consumers accept unknown relationship types.

A Concept or Reference body may link only to resolvable `Concept` or `Reference` documents. External URLs, fragments, unresolvable targets, non-Markdown targets, `log.md`, and untyped navigation indexes invalidate the document. Represent an external URL with a Reference, then link the Concept to that Reference. Link validation recognizes inline links, full, collapsed, and shortcut reference-style links, and URI and email autolinks. It ignores link-like text in backtick and tilde fenced code blocks. Each resolved internal filepath MUST have one destination declaration per document. Use one reference-style definition for a filepath linked more than once and repeat its label. A typed `index.md` is consumable knowledge. Every index abstract MAY link to any consumable document outside the directory that contains the index. It MUST NOT link to a document in that directory or below it.

## Investment

Investment is a measure of authority for concepts. Evaluate it per document with [knowledge-cli](references/knowledge-cli.md)

```text
confidence = citation coverage + average recursive linked-concept confidence
if both confidence inputs are nonzero, confidence = confidence / 2
consistency = ((beta + exposure) / (beta + exposure + horizon)) ^ (alpha + updates)
investment = confidence * consistency
when investment.connection.target is set:
  coverage = F / (F + G), or 1 when F + G = 0
  breadth = (F + Q) / (F + Q + max(T - Q, 0))
  connection = coverage * breadth
  investment = confidence * consistency * connection
```

Confidence is the evidence gate for usable knowledge. A non-open Concept MUST have confidence greater than `0.0`; treat zero confidence as an unresolved knowledge gap and either add support or make the Concept open. Confidence scores the support that directly linked References and linked Concepts provide. Citation coverage is the local union coverage of original-text term tags. Linked-concept confidence is the average confidence of outbound Concept links, evaluated recursively. Divide their sum by two only when both values are nonzero. An empty average is `0.0`.

Evaluate each Concept once per command. Cache completed confidence values and reuse them when another link reaches the same Concept. When a link reaches a Concept that is currently being evaluated, exclude that link from the linked-confidence average to stop the cycle. Use `knowledge-cli confidence` to inspect these scores.

Consistency is the posterior predictive probability of no meaningful revision during the policy horizon. `updates` is the number of `history.updates` entries at or before the evaluation time. `exposure` is the elapsed time from `history.created` to the evaluation time, expressed in `time_unit`. `alpha` and `beta` are the shape and rate of the Gamma prior. Define one shared consistency policy in the root `index.md`:

```yaml
---
knowledge_format_version: "1.0"
confidence:
  required: true
investment:
  consistency:
    model: gamma-poisson
    time_unit: day
    alpha: 1.0
    beta: 365.0
    horizon: 30.0
  connection:
    target: 3
---
```

Set `confidence.required` to `true` to make verification reject a non-open Concept with confidence `0.0`. An absent or false value leaves this gate disabled.

Use `second`, `minute`, `hour`, or `day` as `time_unit`. Set `alpha`, `beta`, and `horizon` to positive numbers. Interpret `beta` and `horizon` in `time_unit`.

Set `investment.connection.target` to a positive integer to activate connection investment for every Concept. `F` counts fulfilled normalized existence requirements, `G` counts open requirements, `Q` counts distinct explicit Concept links incident to the Concept that fulfill a requirement at either endpoint, and `T` is the target. A requirement needs an explicit link in its property's direction from the Concept to count as fulfilled. When `Q >= T` and `G = 0`, connection is `1`. Without this setting, investment uses confidence and consistency alone.

Connections are the recursive document links from a concept. Use `knowledge-cli connections` to list them with each document's `type` and the `tags` it shares with the requested concept.

## Indexes

Each Topic, Package, and Source directory has an `index.md`. Its frontmatter identifies the Concept or Reference. Put its abstract above a horizontal separator (`---`) and its table of contents below. Put a blank line before and after the separator. Keep links to documents in the index directory or below it in the table of contents. The table of contents MUST link every file and child directory directly beside the index, excluding `index.md` and `log.md`. A directory link resolves to its child `index.md`. Use a relative path and short description for each link. Apply the document's link rules to its table of contents.

```markdown
---
type: Concept
title: APIs
description: Groups API concepts.
tags: [apis, software]
history:
  created: 2026-09-19T12:00:00Z
  updates: []
---
API concepts describe service interfaces.

---

# Contents

- [Widget API](widget-api.md) - Authentication and request limits.
```

The root `index.md` contains tree policies and navigation. The `references/index.md` lists reference domains and packages. The `references/packages/index.md` lists packages. These navigation indexes do not represent a Topic, Package, or Source.

CLI commands target a Topic, reference domain, or Package by its `index.md` or parent directory. `read` appends the table of contents for an explicitly targeted index and omits it for ancestor indexes.

`read` accepts an explicitly targeted `index.md` when its frontmatter or abstract is missing. Other commands require a conforming knowledge document.

## Logs

Record changes within a directory scope to `log.md`. Use date groups in descending order and ISO 8601 dates.

```markdown
# Update Log

## 2026-09-19

- **Created** - [Widget API reference](/references/example.com/widget-api.md)
- **Removed** - ...
- **Modified** - ...
  - List of modifications
```

## Conformance

1. Each `.md` file other than root navigation indexes and `log.md` is a valid `Reference` or `Concept` knowledge document.
2. Each knowledge document has all common required fields, its class-specific required fields and body content, every ancestor topical tag, and at least one term tag.
3. Each reference `resource` identifies a persistent source; ordinary source references are unique after normalization; each Package and sanctioned execution resource matches an ordinary source Reference.
4. Each Concept or Reference body and table-of-contents link resolves to a consumable Concept or Reference document; neither type links to external URLs or infrastructure, Reference links remain below `references/`, and each internal filepath has one destination declaration per document.
5. Each `index.md` and `log.md` follows its defined form, each Topic directory contains a Concept `index.md`, and each Source or Package directory contains one correctly scoped Reference `index.md`. Every index-abstract link targets a consumable document outside the index directory. Each index table of contents links every file and child directory at that level except `index.md` and `log.md`.
6. Each concept history starts with a valid `created` and contains ordered update timestamps at or before evaluation time.
7. When root `confidence.required` is `true`, each non-open Concept has confidence greater than `0.0`; only an open Concept may have confidence `0.0`.

Consumers accept missing optional fields, unknown extension fields, unknown subtype values, and missing navigation indexes. Consumers preserve readable content when optional metadata is incomplete and report conformance errors at the document and field where they occur.

## Operations

- [Use knowledge](references/use-knowledge.md)
- [Add knowledge](references/add-knowledge.md)
- [Maintain knowledge](references/maintain-knowledge.md)
