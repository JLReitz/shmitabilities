# Third-Party Licenses

This package (`@jlreitz/pi-files-and-shmit`) imports, vendors, or builds several
third-party components. Their licenses are summarized below.

## lspmux (EUPL-1.2)

- **Component**: `lspmux` — an LSP server multiplexer binary
- **Source**: https://codeberg.org/p2502/lspmux
- **Version**: 0.3.0 (published to crates.io)
- **License**: European Union Public Licence v1.2 (EUPL-1.2)
- **Full text**: see `LICENSE-lspmux.txt` in this directory

### How it is used

This package builds the **unmodified** upstream `lspmux` binary from the
crates.io source at `npm install` time via a best-effort postinstall
`cargo install lspmux --version 0.3.0 --root <pkg-root> --locked`. The
resulting binary is invoked as a **separate process** (arm's-length
interoperation, not derivation or linking). No lspmux Rust source is
vendored into this repository — source provenance remains at
codeberg/crates.io.

EUPL-1.2 is compatible with GPLv2+/GPLv3 (per its compatibility annex).
MIT redistribution of an unmodified EUPL binary with attribution is
permitted.

### Opting out

Set `SHMIT_NO_LSPMUX=1` at install time to skip the lspmux build. The LSP
subsystem falls through to direct server spawning (transparent degradation
— lspmux is a pure optimization).

## Other third-party components

- **`@oh-my-pi/hashline@16.2.9`** (npm dependency with a committed
  Node-compatibility patch under `patches/`): MIT — see upstream.
- **`pi-ast` at revision `3047c27c332c5629c8e063283d349384c10c9a56`,
  `ast-grep-core`, and its tree-sitter grammar closure** (compiled into the
  native `pi_ast` addon): MIT — see upstream.
- **oh-my-pi LSP subsystem** (vendored pure-TS under `src/vendor/lsp/` and
  `src/vendor/jsonrpc/`): MIT — see upstream.
