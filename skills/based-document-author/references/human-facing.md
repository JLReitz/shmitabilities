# Human-Facing Documentation Conventions

Human-facing content is read by a person, usually on a screen, usually while they are deciding
something. It goes in presentations, design documents, concept documents, READMEs, proposals, and
narrative reports. The base conventions in `SKILL.md` apply in full; the rules below are additive
and specific to this audience.

## Voice

Engaging and direct. Write to a colleague who is smart, busy, and skeptical. Lead with the point
that matters, then earn the reader's attention on the way down. Keep sections short enough to fit
on one screen where the content allows.

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
project state" - or something a reader can scan and land on. Never a sentence with a predicate;
"The registry records which session owns which task" spends the reader's first glance on a claim
they cannot yet use.

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

Nothing invented here stands in for a real name: not a group label ("collection", "the batch",
"both packages"), not a count, not a role description, and not a label minted to point at something
by property, function, position, or state ("the CMake-heavy package", "the failing one", "the first
package migrated", "the earlier decision"). Where the thing does not have a name of its own,
describe it in full at every mention.

## Technical design structure

Open a technical design with the subject name and a one to two sentence introduction that
summarizes its contract.

Move from stable context to dynamic behavior. For example:
- Literal terminology used by the document.
- Dependencies, component boundaries, ownership.
- Configuration, input shapes, validity rules.
- Lifecycle.
- Shared execution, ordering, timing, other mechanisms.
- Individual features.

Include only the parts that apply. Put shared mechanisms before the operations that depend on them.

Describe behavior through the stable mechanism that explains the contract or result. Name an
implementation primitive only when the behavior depends on it. State operations in execution order,
then state the observable results.

### Code excerpts

Put an exact declaration immediately before the behavior that depends on it. Include public entry
points, input and output types, contract-bearing state identifiers, and constraints that determine
behavior.

Prefer declarations to copied implementation bodies. Keep identifiers, types, and values verbatim.

### Operation sections

Use the same internal order for related operations:
- Entry point and contract-bearing state.
- Initial-entry, restart, and precondition behavior.
- Ordered requests, responses, and state transitions.
- Deadlines, failure persistence, and recovery.
- Terminal status and its observable meaning.

## Change descriptions

State the required behavior and the conditions that produce different outcomes. State the solution
as ordered operations, the mechanism needed to explain them, and the resulting observable state.
State testing as the behaviors and environments exercised.

## Diagrams

Diagrams are expected.

Where a document describes interaction between components, behavior over time, or a state machine,
include a diagram — prose alone forces the reader to hold the whole topology in working memory,
and they will not.

Detail is the point. Label the edges — the message, the trigger, the condition, the
direction. Show the failure path alongside the happy path.

Select the diagram by the relationship:
- A topology diagram shows component boundaries, dependencies, and ownership.
- A sequence diagram shows messages, update cycles, deadlines, and interactions over time.
- A state or flow diagram shows operation steps, branches, and outcomes.

Place each diagram next to the prose it explains. Label ever edge with the message, trigger,
condition, result, or handoff that crosses it. Show failure and recovery paths with the successful
path.

```
        ┌──────────┐   1. request(payload)    ┌──────────┐
        │  Client  │ ───────────────────────► │  Broker  │
        └──────────┘                          └────┬─────┘
             ▲                                     │ 2. enqueue
             │  4b. reject(reason)                 ▼
             │                                 ┌──────────┐
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

### Draw text diagrams with Unicode line art

Text diagrams MUST use Unicode single-line box-drawing characters for corners, lines, tees, and
crossings.

| Character | Unicode | Use |
|---|---|---|
| `┌` | U+250C | Top-left corner |
| `┐` | U+2510 | Top-right corner |
| `└` | U+2514 | Bottom-left corner |
| `┘` | U+2518 | Bottom-right corner |
| `─` | U+2500 | Horizontal line |
| `│` | U+2502 | Vertical line |
| `├` | U+251C | Tee toward the right |
| `┤` | U+2524 | Tee toward the left |
| `┬` | U+252C | Tee downward |
| `┴` | U+2534 | Tee upward |
| `┼` | U+253C | Crossing |
| `▲` | U+25B2 | Upward arrowhead |
| `►` | U+25BA | Rightward arrowhead |
| `▼` | U+25BC | Downward arrowhead |
| `◄` | U+25C4 | Leftward arrowhead |

## Diagnostic messages

Name the operation, the step that failed, and the observed cause.

## Source verification

Check each claim about a platform, library, protocol, or external component against its source
before writing it.
