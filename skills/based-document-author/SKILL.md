---
name: based-document-author
description: Use to apply the jlreitz house writing conventions while writing.
---

# Documentation Conventions

The following conventions govern any form of written prose. Apply them while writing and check against them while reviewing. This document obeys its own conventions; write to match it.

## Pick the audience first

| Audience | Artifacts | Reference |
|---|---|---|
| Agent | `AGENTS.md`, `DEFECTS.md`, skills, context files, handoffs, SOPs, prompts, agent definitions | `references/agent-facing.md` |
| Human | Presentations, design documents, concept documents, READMEs, proposals, narrative reports | `references/human-facing.md` |

Where an artifact serves both audiences, write it human-facing.

## State each fact once

State each fact once, at its most load-bearing point. Do not restate across a response. Do not add a summary that re-bullets what was already said in full above. Do not add parenthetical asides. Cut clarifying clauses that restate what the surrounding sentence already implies.

Do not restate a rule under a label. A heading such as "Named anti-pattern", "Note", or "Reminder" that re-expresses a rule stated above adds a second place for the rule to drift.

State a rule once and stop. Cut the counterfactual ("the alternative is X"), the symmetric case ("the deeper document wins where they agree and adds where they do not"), and the because-clause naming what goes wrong. Where the failure is what the reader needs, write the rule as an imperative that avoids it — "write under a lock to protect against concurrency" — rather than a narrative about the failure.

## Thin by default

One sentence per point where one suffices. Fragments over full paragraphs when meaning stays intact. Terse is not empty — every fact the reader needs stays; only restatement, padding, and narrated-history die.

## Positive comparisons only

Compare things by what they are and what they share. Do NOT frame a statement as the absence of a relationship ("X does not correlate with Y", "no link between A and B", "unlike X, Y has no…"), and do NOT define a thing by what it is not.

Admissible only where the negative correlation is itself the document's subject — a doc whose purpose is to record that two things are independent, or that an expected relationship does not exist, states that directly.

Cut a sentence whose only work is to deny a misreading of the sentence before it. Where a rule invites the wrong reading, fix the rule's wording.

## Negate the verb

Where a statement of absence is admissible, negate the verb — "does not include", not "includes no". Object-fused negation ("holds none", "names nothing", "writes no code") inverts the sentence and makes the verb's polarity depend on its argument.

## Cross-reference by name only

Name the document or section that holds a related rule at the point the reader needs it. Do not open a section by stating where its subject is governed, and do not state what a section prevents or achieves — the rules in it state that.

Embed links to any references outside of the document using the medium's native format by default. If an alternative convention exists, follow that instead.

## One example, where the rule needs one

Include an example only where the rule's application is ambiguous without it. Give one; do not enumerate phrasings that mean the same thing.

## Name units of work after the work

Name procedures, functions, and sections after their unit of work, not their input shape. A procedure that can span multiple items names itself after the task.

## Omit Counts

State a count only when it comes from a stable external signal and is the document's subject.

Omit every other count. These drift between the write and the read, and a stale number reads as fact. Where the count stands for things that have names, name them; otherwise state the property without quantifying it.

## Use simplified technical english

Draw prose vocabulary from the ASD-STE100 approved word list.

- One word, one meaning. A word that means one thing in one sentence means the same thing everywhere in the document.
- One meaning, one word. Do not vary wording for style; repeat the approved word instead of reaching for a synonym.
- Do not verb a noun ("action the request") and do not noun a verb ("perform a validation") where the approved form exists ("validate").
- Prefer the short approved verb to a phrasal verb or a compound construction.
- Literal verbs for artifacts. A document contains, states, or guarantees; it does not carry, bind, hold, speak, or own. A metaphor in the verb slot reads as three different relations across one document.
- Active voice, present tense, one statement or instruction per sentence.

Technical names and verbs are exempt and stay verbatim, including:
- identifiers
- tool names
- file paths
- field names
- command strings
- standard terms
- error text
