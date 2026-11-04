# Based capabilities

The `based-*` skills provide an optional baseline of developer practices. They are **based** in
both useful senses: foundational enough to build on and opinionated enough to have already picked
a side. The name is a pun, but the defaults are serious. Someone had to end the bikeshedding.

These skills stand apart from the Shmitty workflows. A project, workspace, or user selects the
applicable `based-*` skills directly. Each selected skill then composes the narrower practices it
names; selecting one does not quietly enroll the project in an unrelated workflow loyalty program.

## Composition

Start with the skill that matches the work. Follow each arrow to the additional practice that the
entry skill applies.

```text
Language and software practices

┌───────────────────────────────────────────────────────────────────────────┐
│ based-cpp-dev   based-node-dev   based-python-dev   based-rust-dev        │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ shared software rules
                                    ▼
                         ┌────────────────────┐
                         │ based-software-dev │
                         └──────────┬─────────┘
                                    │ documentation and comment prose
                                    ▼
                        ┌───────────────────────┐
                        │ based-document-author │
                        │                       │
                        └───────────────────────┘

Agent development practices

                           ┌────────────────────┐
                           │ based-skill-author │
                           └──────────┬─────────┘
                                      │
                        ┌─────────────┴──────────────┐
                        │ skill prose                │ bundled scripts
                        ▼                            ▼
             ┌───────────────────────┐    ┌───────────────────┐
             │ based-document-author │    │ based-harness-dev │
             └───────────────────────┘    └─────────┬─────────┘
                                                    │ Node.js packages
                                                    ▼
                                         ┌────────────────┐
                                         │ based-node-dev │
                                         └───────┬────────┘
                                                 │ shared software rules
                                                 ▼
                                         ┌────────────────────┐
                                         │ based-software-dev │
                                         └────────────────────┘
```

The arrows show skill composition and conditional reference loading. `based-document-author` is
the writing foundation, while `based-software-dev` contains the language-neutral software
foundation and its object-oriented and test-development references.

## Shared foundations

### `based-document-author`

Defines house conventions for human-facing and agent-facing prose. It selects the audience first,
keeps each fact in one place, uses literal terminology, and gives diagrams real work instead of
letting them loiter decoratively beside the text.

### `based-software-dev`

Defines shared design, compatibility, dependency, logging, and writing practices for software in
any language. It prefers value semantics, ties resource cleanup to a scope or object lifetime, and
groups related source lines into blank-line-separated sections. It prefers immutable local values,
parenthesizes compound-condition operands, validates platform assumptions at the earliest
supported boundary, and makes discarded returns explicit. Its
object-oriented reference defines function-oriented APIs over rich domain objects and documents
polymorphic contracts separately from implementation mechanisms. Its test-development reference
develops standing-document behaviors and mapped tests as one specification unit, with shared case
structure, a shared `tests/` location for standalone test files, and test-double organization. The
skill requires user confirmation before production implementation, favors the simplest sufficient
design, preserves caller-visible interfaces, and requires an external dependency to earn its chair
at the table.

### API documentation contract

An API documentation comment is the caller-facing contract attached to a function, method, or
callable type. Each language uses its native comment syntax while presenting the same applicable
information in the same order.

```text
┌─────────┐   observable purpose   ┌─────────┐   contract conditions   ┌────────────┐
│ Summary ├──────────────────────► │ Details ├───────────────────────► │ Parameters │
└─────────┘                        └─────────┘                         └─────┬──────┘
                                                                           │ meaning,
                                                                           │ range,
                                                                           │ ownership
                                                                           ▼
┌─────────┐   unclear correct use  ┌──────────────────┐   error condition  ┌────────┐
│ Example │ ◄───────────────────── ┤ Failure outcomes │ ◄───────────────── ┤ Result │
└─────────┘                        └──────────────────┘                    └────────┘
```

The summary states the observable purpose in one sentence. Details state callable-wide
preconditions, postconditions, side effects, ownership, and lifetime. Parameters appear in
declaration order and describe the contract information that the signature does not express. The
result states the meaning of the returned or yielded value and the condition for each discrete
outcome. Failure outcomes state each caller-visible error value, exception, panic, or safety
condition. One example follows when the preceding contract does not make correct use clear.

Sections that do not apply are omitted. Parameter types, return types, default expressions, and
other information already stated completely by the signature are not repeated.

| Contract information | C and C++ | TypeScript | Python | Rust |
|---|---|---|---|---|
| Summary | `@brief` | Summary paragraph | Summary line | First paragraph |
| Details | Prose or `@details` | `@remarks` | Body prose | Body prose |
| Parameters | `@param[in,out]` | `@param` | `Args:` | `# Arguments` |
| Successful result | `@return`, `@retval` | `@returns` | `Returns:`, `Yields:` | `# Returns` |
| Failure outcomes | `@retval`, `@throws` | `@throws` | `Raises:` | `# Errors`, `# Panics`, `# Safety` |
| Example | `@code` | `@example` | `Example:` | `# Examples` |

C and C++ share one Doxygen layout in `based-cpp-dev`; C++ template parameters use `@tparam` in
declaration order. TypeScript uses TSDoc and configures its tooling for the extended `@throws` tag
when required. Python uses PEP 257 docstrings with Google-style sections. Rust uses rustdoc
Markdown sections and runnable doctests.

The native layouts follow [Doxygen: Special Commands](https://www.doxygen.nl/manual/commands.html),
[TSDoc](https://tsdoc.org/pages/intro/approach/),
[PEP 257 – Docstring Conventions](https://peps.python.org/pep-0257/), the
[Google Python Style Guide](https://google.github.io/styleguide/pyguide.html),
[How to write documentation](https://doc.rust-lang.org/rustdoc/how-to-write-documentation.html),
and the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/documentation.html).

The practices define source-comment structure. Each project selects and configures any generator,
validator, publication destination, and generated-output lifecycle. A project can apply the source
contract without generating a separate documentation artifact.

## Development cadence

Standing documents and tests change after planning completes. The agent states each planned outcome
in the affected standing document without its planning history and preserves the document's layout,
style, and format. Mapped tests join those updates. The user confirms the plan, standing-document
updates, and mapped tests before production implementation gets a turn.

```text
┌──────────┐   completed plan    ┌────────────────────────────┐
│ Planning ├───────────────────► │ Standing documents + tests │
└──────────┘                     └─────────────┬──────────────┘
    ▲                                          │
    │                                          ▼
    │           revision             ┌───────────────────┐
    └────────────────────────────────┤ User confirmation │
                                     └─────────┬─────────┘
                                               │ yes
                                               ▼
                                     ┌───────────────────────┐
                                     │ Production            │
                                     │ implementation        │
                                     └─────────┬─────────────┘
                                               │ passing mapped tests
                                               ▼
                                     ┌───────────────────┐
                                     │ Refactor and      │
                                     │ validate          │
                                     └───────────────────┘
```

Each test identifies the standing document, heading, and behavior it covers unless the project
provides a requirement identifier. When a confirmed goal, observable behavior, interface, or
constraint changes, the agent revises the plan, standing-document behavior, and mapped tests
together, then obtains renewed user confirmation.

## Language practices

### `based-cpp-dev`

Applies Google C++ style with the repository's Allman-brace and naming conventions. It defines
CMake project configuration, includes a reusable `clang-format` configuration, and adds C++17 and
C++20 guidance, interface lifetime rules, exception boundaries, `noexcept`, platform assertions,
GoogleTest, and GoogleMock. Its API documentation reference groups C and C++ under one Doxygen
contract.

### `based-node-dev`

Defines npm, TypeScript with Allman braces, ECMAScript module, package layout, build output, and
dprint formatting with `@dprint/typescript` and a reusable configuration. It uses Vitest and
provides project references for standard packages and code embedded inside another component,
because even JavaScript benefits from knowing where it lives.

### `based-python-dev`

Defines Python 3.9 compatibility, PEP 8 source, Ruff formatting with a reusable configuration,
`pyproject.toml`, pytest, and standard or embedded package layouts. Newer syntax remains welcome
after the project raises its declared minimum version; time travel remains outside scope.

### `based-rust-dev`

Defines Cargo configuration, Rust Style Guide and `rustfmt` conformance with a reusable
configuration, rustdoc, the built-in Rust test framework with Mockall mocks, and standard or
embedded crate layouts.

## Agent development practices

### `based-skill-author`

Defines concise skill instructions, progressive disclosure, package structure, external artifact
content, and exact command invocation. Detailed procedures belong in focused references, where
they can be loaded when needed instead of greeting every task at the door.

### `based-harness-dev`

Defines portable agent workspace infrastructure, hooks, scripts, packages, client interfaces, and
registration. Its references cover Codex, Claude Code, DeepSeek Harness, and Pi integration while
keeping client-neutral behavior in reusable package cores.

## Project configuration

The skills provide practices, not a universal project generator. Existing project requirements
remain authoritative for supported language versions, public interfaces, build systems, and
dependency constraints. A project records any deliberate override where its agents and developers
will encounter it.

Language and harness practices select tools such as CMake, npm, TypeScript, dprint, Vitest, Python,
Ruff, pytest, Cargo, `rustfmt`, Mockall, `clang-format`, GoogleTest, and GoogleMock. Those tools
become dependencies of the project that applies the practice; they are not runtime dependencies of
the Shmitabilities distribution. Repository package dependencies and installation procedures
remain in [Dependencies](dependencies.md).

The language formatter configurations use four-space indentation, spaces instead of tabs, and a
120-column target where the formatter supports them. The Node.js configuration also applies Allman
braces. Python and Rust retain their language-native syntax layout.

## Extension points

Add a specialized `based-*` skill when a development subject needs a coherent baseline that can
stand alone. Give it one clear entry condition, keep its own rules in its package, and reference
the nearest shared foundation by exact skill name.

Extend an existing skill with a focused reference when the new guidance is conditional detail of
the same capability. A new filename is cheaper than a new abstraction, but only by a little.

Keep environment-selected workflow policy outside the `based-*` set. Shmitty skills may coexist
with these practices through governing instructions, while each family keeps its own entry points,
state, and lifecycle.
