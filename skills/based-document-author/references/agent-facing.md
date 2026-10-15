# Agent-Facing Documentation Conventions

Agent-facing content is read by a model as context, not by a person on a screen. The base conventions in `SKILL.md` apply in full; the rules below are additive and specific to this audience.

## Voice

Professional and declarative. State rules, facts, and constraints. No second-person coaching, no encouragement, no rhetorical questions, no humor, no metaphor. The reader is a model executing instructions, so ambiguity costs more than dryness.

Use RFC 2119 keywords (MUST, MUST NOT, SHALL, SHOULD, MAY) where a statement is a requirement rather than a description. Reserve them for requirements; prose that describes current state uses plain indicative mood.

## No line breaks in prose

Each paragraph is a single unwrapped line in the source file.

Structural exceptions where a newline is part of the markdown construct rather than a wrap.

## Structure states the meaning

Headings, lists, and tables are the primary organizing tools. A model retrieves by structure, so a fact that belongs under a heading goes under that heading rather than in a preamble. Keep heading text literal and searchable — name the rule or the subject, not a theme.

Front-load the operative statement in each section. The first sentence under a heading states the rule; supporting detail follows.

## Naming and identifiers

Use exact identifiers verbatim: file paths, tool names, agent names, field names, command strings, and error text. Spell each as its own system of record spells it. Where a rule depends on an identifier, quote the identifier in backticks rather than paraphrasing it.

Reference a skill by its exact name only. Do not link to its `SKILL.md` or include its directory path.

## Diagrams

Include a diagram only where a control-flow or data-flow relationship is the subject and prose would require the reader to hold multiple simultaneous relationships in memory. Prefer a table over a diagram. Where a diagram is warranted, keep it minimal — nodes and edges only, no decoration.
