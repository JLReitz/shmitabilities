# Rust project configuration

Use `Cargo.toml` as the baseline configuration file. Apply this template when initializing a project, replace each placeholder, and remove optional sections that the project does not use:

```toml
[package]
name = "project-name"
version = "0.1.0"
edition = "2021"
description = "Short project description."
readme = "README.md"

[dependencies]
crate-name = "..."

[dev-dependencies]
test-crate = "..."

[build-dependencies]
build-crate = "..."

[features]
default = []
feature-name = ["crate-name/feature"]

[[bin]]
name = "command-name"
path = "src/bin/command_name.rs"

[lib]
name = "project_name"
path = "src/lib.rs"

[workspace]
members = [
    "crates/*",
]

[workspace.dependencies]
shared-crate = "..."
```

- Keep package metadata in `[package]`.
- Record runtime crates in `[dependencies]`.
- Record test-only crates in `[dev-dependencies]`.
- Record build-script crates in `[build-dependencies]`.
- Declare features in `[features]`.
- Declare binaries in `[[bin]]` and libraries in `[lib]`.
- Use `[workspace]` and `[workspace.dependencies]` for multi-crate projects.
- Preserve `Cargo.lock` for applications and other projects that commit a lockfile.
