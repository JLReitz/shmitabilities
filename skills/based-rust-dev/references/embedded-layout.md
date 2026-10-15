# Embedded Rust package layout

Use a dedicated embedded package when Rust code has its own dependencies, compilation, or tests:

```text
host-component/
├── component files...
└── rust/
    ├── Cargo.toml
    ├── Cargo.lock
    ├── src/
    │   ├── lib.rs
    │   └── main.rs
    └── tests/
        └── integration.rs
```

- Use `rust/` when the host does not define a directory for executable code.
- Use the host's `scripts/`, `tools/`, `plugins/`, or equivalent directory when that convention exists.
- Keep `Cargo.toml`, `Cargo.lock`, source, and tests inside the embedded package boundary.
- Add the embedded package to the repository workspace when the repository builds and tests it with workspace-wide Cargo commands.
- Keep the embedded package standalone when the host treats it as an isolated tool or implementation detail.
