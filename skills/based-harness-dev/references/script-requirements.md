# Script requirements

Apply the `based-*-dev` skills, when available for the chosen language, while implementing modules and CLI.

Prefer a single language for the entire harness, default to Python unless the project specifies another language.

## Architecture

- Split implementations into reusable base modules and command-line interfaces that task-specific extension packages can extend.
- Design base modules for extension and implement only current requirements under YAGNI.
- Isolate cross-client support in client-specific modules. Keep base modules client-agnostic.

## Runtime configuration

Runtime defaults MUST be configurable through environment variables whose names start with `SHMIT_`.

## Output contracts

- Module APIs MUST return data structures.
- CLI MUST format stdout by data type as specified in [Progressive disclosure](progressive-disclosure.md).

## Exit contract

- Return `0` when the full process completes and writes its output to stdout. Recoverable failures that must reach the agent use this status.
- Return `1` when resource acquisition fails or another unrecoverable error occurs. Print the error description to stderr. A command MAY also use `1` for documented validation findings written to stdout.
