---
name: based-node-dev
description: Initialize and maintain Node.js projects with npm, TypeScript, ESM, and the baseline package.json configuration. Use when creating or modifying Node.js project configuration or source code.
---

# Based Node.js development

## Language

- Use TypeScript by default.
- Use JavaScript only when the project or user requires it.
- Use ECMAScript modules and set `"type": "module"` in `package.json`.
- Apply the `based-oop-dev` skill to object-oriented TypeScript and JavaScript design and implementation.

## Project configuration

Apply [Node.js project configuration](references/project-configuration.md) when creating or modifying `package.json`.

## Package layout

- For an installable package, apply [Standard Node.js package layout](references/standard-layouts.md).
- For Node.js code embedded in another component, apply [Embedded Node.js package layout](references/embedded-layout.md).

## Unit tests

- Use Vitest for unit tests.
- Store tests under `tests/` and name test files `*.test.ts`.
- Use `vitest run` for the default `test` script and `vitest` for the `test:watch` script.
- Run `tsc --noEmit` separately because Vitest transpiles TypeScript without type-checking it.
- Add `@vitest/coverage-v8` and a `test:coverage` script when the project measures coverage.

## TypeScript source

- TypeScript code MUST conform to the Google TypeScript Style Guide.
- Documentation comments MUST use TSDoc syntax.
- Prose in documentation comments and annotations MUST conform to the `based-document-author` skill's human-facing conventions. The Google TypeScript Style Guide controls source-code formatting.
- Compile TypeScript source from `src/` to `dist/`.
- Include source files in published packages only when consumers require them.
- Exclude generated `dist/` files from source control unless the project distributes them directly from the repository.
