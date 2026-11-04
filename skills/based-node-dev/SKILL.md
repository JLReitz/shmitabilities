---
name: based-node-dev
description: Initialize and maintain Node.js projects with npm, TypeScript, ESM, and the baseline package.json configuration. Use when creating or modifying Node.js project configuration or source code.
---

# Based Node.js development

Apply the `based-software-dev` skill to Node.js design and implementation.

- Use TypeScript by default.
- Use JavaScript only when the project or user requires it.
- Use ECMAScript modules and set `"type": "module"` in `package.json`.

## Style

- TypeScript code MUST conform to the Google TypeScript Style Guide with Allman braces overriding its brace convention.
- Documentation comments MUST use TSDoc syntax and [TypeScript API documentation](references/api-documentation.md).
- Compile TypeScript source from `src/` to `dist/`.
- Include source files in published packages only when consumers require them.
- Exclude generated `dist/` files from source control unless the project distributes them directly from the repository.

### Formatting

- Format TypeScript and JavaScript with dprint and `@dprint/typescript`.
- Configure `useBraces` as `always`, `bracePosition` as `nextLine`, and `nextControlFlowPosition` as `nextLine`.
- Run `dprint fmt` to write formatting changes and `dprint check` to check formatting.

## Project configuration

Apply [Node.js project configuration](references/project-configuration.md) when creating or modifying `package.json`.

## Package layout

- For an installable package, apply [Standard Node.js package layout](references/standard-layouts.md).
- For Node.js code embedded in another component, apply [Embedded Node.js package layout](references/embedded-layout.md).

## Unit tests

- Use Vitest for unit tests.
- Name test files `*.test.ts`.
- Use `vitest run` for the default `test` script and `vitest` for the `test:watch` script.
- Run `tsc --noEmit` separately because Vitest transpiles TypeScript without type-checking it.
- Implement data-driven suites with `test.each` or `it.each`.
- Use Vitest mock functions or module mocks when a test must observe or control an interface interaction.
- Add `@vitest/coverage-v8` and a `test:coverage` script when the project measures coverage.
