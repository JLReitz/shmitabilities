# Human-Facing Documentation Conventions

Human-facing content is read by a person, usually on a screen, usually while they are deciding
something. It goes in presentations, design documents, concept documents, READMEs, proposals, and
narrative reports. The base conventions in `SKILL.md` apply in full; the rules below are additive
and specific to this audience.

## Voice

Engaging and direct. Write to a colleague who is smart, busy, and skeptical. Lead with the point
that matters, then earn the reader's attention on the way down.

What that looks like in practice:

- Concrete nouns and active verbs. A subsystem *drops* a message; it does not "experience message
  loss".
- Varied sentence length. A short sentence after a long one lands.
- Address the reader, in the imperative, from their own perspective.
- Analogy where a mechanism is unfamiliar, and only there. One good analogy per concept; a second
  competes with the first.
- Describe current state, not how it got there. State the thing as it is *now*.
- No cleft constructions. "A schema decides what is admissible", not "a schema is what decides
  what is admissible". Put the emphasis in the verb.
- No aphorism openers. A section starts on its mechanism, not on a quotable line that sets up a
  contrast the mechanism then resolves.
- One clause, not two sentences, for a paired contrast. "An agent writes plausible text, a schema
  decides whether the text is admissible."
- Bold the load-bearing word, not the clause.
- Fold an attribute into the noun phrase it modifies rather than giving it its own paragraph —
  "a thin entry point over a package of modules that is unit-testable".
- Assume the domain's primitives. Do not define a term the reader's own tooling names.
- Do not name an audience role. Write "existing services", not "services the team already uses";
  "people", not "reviewers".

What it does not look like: exclamation marks, hype adjectives, marketing superlatives, or filler
transitions that announce structure instead of advancing it.

Roadmaps, phase plans, and decision logs shall not be cited.

## Headings name the thing or its purpose

A heading is a noun phrase: the artifact or what it is for — "Local task registry to maintain
project state". Never a sentence with a predicate; "The registry records which session owns which
task" spends the reader's first glance on a claim they cannot yet use.

## Never announce a list

Drop "Four properties follow from this", "Two consequences:", and "Three things this gets right:".
Use a colon lead-in ("What that buys:") or the list alone. An announced count is a promise the
reader audits instead of reading, and it goes stale on the next edit.

## Bullets state one claim each

A bullet states its claim in its first clause and supports it in at most one sentence. Drop the
consequence clause. Where support needs more than one sentence, indent it as sub-bullets and write
those telegraphically.

Bold a bullet's opening claim only where the bullet is one of a set the reader scans to find one
entry. A bullet read in sequence with its neighbors does not take bold.

## Negation in a prepositional phrase

"Negate the verb" in `SKILL.md` reaches the verb's object. In human-facing prose it also reaches a
"with no X" phrase that stands for an event, a behavior, or a state — rewrite those as a clause
whose verb does the work.

- `shows idle or complete with no report received` → `shows idle or complete and its report has not
  arrived`
- `conflicting sources with no resolution` → `conflicting sources that remain unreconciled`
- `states own knowledge gaps; no emoji` → `states own knowledge gaps; does not use emoji`

A "with no X" phrase attached to a noun as a standing property stays — "a host with no network
egress" names what the host is, not something that failed to happen.

## Link text is the destination's own title

Cite a target by its own heading or page title, not by its filename and not by a description
of what it covers — "See [Using a CLI for Progressive Discovery](url)".

## Line breaks at column 100

Hard-wrap prose at column 100. Break at a word boundary and put the break where the sentence has a
natural seam — after a clause, before a conjunction — so each line reads as a unit.

Preserve markdown structures over the column rule.

## Use real names

Refer to anything by the name in its own system of record, spelled as that system spells
it. Where a statement covers several named things, name them all.

Nothing invented here stands in for a real name: not a group label ("the sim packages", "the batch", "both packages"), not a count, not a role description, and not a label minted to point at something by property, function, position, or state ("the CMake-heavy package", "the failing one", "the first package migrated", "the earlier decision"). Where the thing does not have a name of its own, describe it in full at every mention.

## Diagrams

Diagrams are expected.

Where a document describes interaction between components, behavior over time, or a state machine,
include a diagram — prose alone forces the reader to hold the whole topology in working memory,
and they will not.

Detail is the point. Label the edges — the message, the trigger, the condition, the
direction. Show the failure path alongside the happy path.

```
        ┌──────────┐   1. request(payload)    ┌──────────┐
        │  Client  │ ───────────────────────► │  Broker  │
        └──────────┘                          └────┬─────┘
             ▲                                     │ 2. enqueue
             │  4b. reject(reason)                  ▼
             │                                ┌──────────┐
             └──────────────────────────────── │  Worker  │
                        4a. ack(id)            └──────────┘
                                                    │ 3. commit
                                                    ▼
                                               ┌──────────┐
                                               │  Store   │
                                               └──────────┘
```

Every diagram includes a caption or a lead-in sentence naming what the reader should take from it,
and every element in the diagram is named in the surrounding prose at least once.

## Best practices

Use headings a reader can scan and land on. Keep sections short enough to fit on one screen where
the content allows.
