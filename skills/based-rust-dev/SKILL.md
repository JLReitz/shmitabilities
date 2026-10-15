---
name: based-rust-dev
description: Initialize and maintain Rust projects with Cargo, the baseline Cargo.toml configuration, the Rust Style Guide, and rustdoc conventions. Use when creating or modifying Rust project configuration, source code, or API documentation.
---

# Based Rust development

## Project configuration

Apply [Rust project configuration](references/project-configuration.md) when creating or modifying `Cargo.toml`.

## Rust source

- Rust code MUST conform to the Rust Style Guide and use the default `rustfmt` configuration.
- Public APIs MUST use rustdoc documentation comments and Markdown conventions.
- Prose in documentation comments and attributes MUST conform to the `based-document-author` skill's human-facing conventions. The Rust Style Guide controls source-code formatting.
- Apply the `based-oop-dev` skill to object-oriented Rust design and implementation.

## Package layout

- For a standalone package or Cargo workspace, apply [Standard Rust package layouts](references/standard-layouts.md).
- For a Rust package embedded in another component, apply [Embedded Rust package layout](references/embedded-layout.md).
