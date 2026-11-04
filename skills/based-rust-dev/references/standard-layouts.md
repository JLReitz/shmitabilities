# Standard Rust package layouts

## Library with a command-line interface

Use this layout by default for a package that provides reusable behavior and a command-line interface:

```text
project-name/
├── Cargo.toml
├── Cargo.lock
├── README.md
├── src/
│   ├── lib.rs
│   ├── main.rs
│   └── domain.rs
├── tests/
│   └── cli.rs
├── examples/
│   └── basic.rs
└── benches/
    └── operations.rs
```

- `src/lib.rs` MUST define the public library API.
- Domain modules MUST contain reusable behavior.
- `src/main.rs` MUST parse process input, call the library, and map results to output and exit status.
- `tests/` MUST contain integration tests.
- Add `examples/` and `benches/` only when the package uses them.
- Exclude the generated `target/` directory from source control.

## Library

Use this layout for a package that provides a library:

```text
project-name/
├── Cargo.toml
├── Cargo.lock
├── README.md
├── src/
│   ├── lib.rs
│   ├── domain.rs
│   └── internal/
│       └── helper.rs
└── tests/
    └── public_api.rs
```

- `src/lib.rs` MUST declare modules and export the public API.
- Public modules MUST represent API concepts.
- Private modules MUST contain implementation details.
- Integration tests MUST use the public API.

## Application

Use this layout for a small executable whose implementation is not reused independently:

```text
project-name/
├── Cargo.toml
├── Cargo.lock
├── README.md
└── src/
    ├── main.rs
    ├── application.rs
    └── domain.rs
```

Move reusable behavior into `src/lib.rs` as the application grows.

## Multiple executables

Use this layout when a package provides multiple executables:

```text
project-name/
├── Cargo.toml
├── Cargo.lock
├── src/
│   ├── lib.rs
│   └── bin/
│       ├── server.rs
│       ├── client.rs
│       └── maintenance/
│           ├── main.rs
│           └── command.rs
└── tests/
    └── workflows.rs
```

- Each `src/bin/*.rs` file MUST define one binary.
- A multi-file binary MUST use `src/bin/<binary-name>/main.rs`.
- Shared behavior MUST reside in the library crate.

## Workspace

Use a workspace when multiple Rust packages are developed, tested, versioned, or released together:

```text
project-name/
├── Cargo.toml
├── Cargo.lock
├── README.md
└── crates/
    ├── domain/
    │   ├── Cargo.toml
    │   └── src/lib.rs
    ├── application/
    │   ├── Cargo.toml
    │   └── src/lib.rs
    └── cli/
        ├── Cargo.toml
        └── src/main.rs
```

- Use a workspace when packages need independent dependency sets, features, publication lifecycles, or compilation boundaries.
- Use a workspace when multiple binaries share internal libraries, platform implementations require separate crates, or a procedural macro requires a `proc-macro` crate.
- Keep modules in one package when modules provide sufficient separation.
- Use a virtual workspace manifest when the workspace root does not define a package.
- Keep members under `crates/` and declare `members = ["crates/*"]`.
- Share dependency versions through `[workspace.dependencies]` and package fields through `[workspace.package]`.
- Keep one `Cargo.lock` and one generated `target/` directory at the workspace root.
