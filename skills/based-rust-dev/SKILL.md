---
name: based-rust-dev
description: Initialize and maintain Rust projects with Cargo, the baseline Cargo.toml configuration, the Rust Style Guide, and rustdoc conventions. Use when creating or modifying Rust project configuration, source code, or API documentation.
---

# Based Rust development

Apply the `based-software-dev` skill to Rust design and implementation.

## Style

- Rust code MUST conform to the Rust Style Guide and the bundled `rustfmt` configuration.

### Formatting

- Run `cargo fmt` to write formatting changes and `cargo fmt --all --check` to check formatting.
- Public APIs MUST use rustdoc documentation comments, Markdown conventions, and [Rust API documentation](references/api-documentation.md).

## Project configuration

Apply [Rust project configuration](references/project-configuration.md) when creating or modifying `Cargo.toml`.

## Package layout

- For a standalone package or Cargo workspace, apply [Standard Rust package layouts](references/standard-layouts.md).
- For a Rust package embedded in another component, apply [Embedded Rust package layout](references/embedded-layout.md).

## Tests

- Use Rust's built-in test framework.
- Use Mockall for mocks.
- Run tests with `cargo test`.
- Mark test functions with `#[test]`.
- Put unit tests in a `tests` module guarded by `#[cfg(test)]`.
- Declare mocks with `mock!` in test-support modules grouped by production component.
- Use Mockall expectations to constrain arguments, call counts, call order, and returned values.
