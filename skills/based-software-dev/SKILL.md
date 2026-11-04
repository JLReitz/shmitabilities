---
name: based-software-dev
description: Apply document-confirmed planning and shared design, compatibility, dependency, and writing rules when creating or modifying software in any language.
---

# Based software development

## Vocabulary

- **Standing document**: A version-controlled project document outside production implementation that defines goals, behavior, interfaces, constraints, or operating procedures.
- **Planning document**: Plan- or task-based documentation that states the planned work, intended outcomes, mapped tests, and validation for user confirmation.
- **Implementation**: Source, configuration, generated artifacts, and other files that make the documented behavior work.

## Development cadence

1. Develop a plan. Obtain the user's decisions until the intended outcome and scope are confirmed, the plan covers each acceptance criterion, and no unresolved in-scope decision blocks implementation.
2. After plan confirmation, update each affected standing document to present the outcome of the planned work.
3. Read [Based test development](references/develop-tests.md) to write or update tests alongside the standing-document behaviors they map to.
4. Present the applied standing-document updates and mapped tests to the user for confirmation.
5. After document and test confirmation, execute the plan.
6. Implementation work is complete when the plan, standing documents, mapped tests, and production implementation state and validate the same behavior.

Revise the plan, standing documents, and mapped tests together when development changes a confirmed goal, observable behavior, interface, or constraint. Obtain user confirmation before continuing implementation work.

## Scope and design

Apply YAGNI to the plan and standing-document outcomes. Implement only the behavior required now. Keep extension points only where a confirmed requirement or likely change gives them a clear use.

Compare viable approaches and their tradeoffs in the plan. Prefer the simplest approach that satisfies the confirmed standing-document outcomes and preserves a clear path for a stated later extension. Keep changes within the confirmed plan. Add related behavior only when a standing document requires it.

Read [Based object-oriented development](references/develop-oop.md) when creating or modifying object-oriented APIs, domain objects, or operations that coordinate objects.

### Values and identity

Prefer value semantics. Introduce reference identity only when confirmed behavior requires shared identity or shared mutation.

### Resource ownership

Tie each acquired resource to a scope or object lifetime when the language supports deterministic cleanup. Otherwise use the language's structured cleanup mechanism. Make ownership transfer explicit. Share ownership only when the resource contract requires it.

### Compatibility

Preserve external interfaces that callers use when modifying existing code. Treat names, signatures, data formats, behavior, and error behavior as interface contracts where callers depend on them. When a required change conflicts with an interface in use, provide a compatible transition or make the interface change explicit for the caller.

Validate platform, representation, and ABI assumptions at the earliest boundary supported by the language.

### Logging

Log the cause of each failure once, at the point where code detects it. Log success only when the component contract requires a state change to be logged.

Name the operation and the step that failed in each failure message. Describe the failure condition with actual values or expected values. Name the constants or types that define those values.

Derive log message content from available data in local variables. Do not add function parameters solely to pass log message content.

### Dependencies

Prefer the language's standard library. Add an external dependency when it provides required behavior that a small, maintainable standard-library implementation cannot reasonably provide.

## Style

Read [API documentation](references/document-apis.md) when creating or modifying an API documentation comment or docstring.

Use the same project-selected formatter version in development and automated checks. Provide separate commands to write formatting changes and to check formatting without changing files.

Bind local values immutably by default. Use a mutable binding only when reassignment is required.

Parenthesize each operand of a compound Boolean condition.

Make an intentionally discarded return value explicit with the language's established syntax.

Keep the lines that complete one local operation contiguous. Separate adjacent source sections with one blank line in declarations, implementations, and tests.

Apply `based-document-author` to standing documents, comments, docstrings, log messages, and other human-facing or agent-facing prose.
