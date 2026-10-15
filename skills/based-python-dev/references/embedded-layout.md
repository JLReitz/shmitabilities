# Embedded Python layout

## Host component

Keep embedded Python within the host component that distributes and invokes it. Use the host's executable-resource directory as the source root when that convention exists.

Use a dedicated `python/` directory when the host does not define an executable-resource directory:

```text
<host-component>/
├── <host files>
└── python/
    ├── command-name
    ├── package_name/
    │   ├── __init__.py
    │   ├── commands.py
    │   └── ...
    └── tests/
        └── test_package_name.py
```

- Keep the executable, import package, and tests under one source root.
- Keep `command-name` as the stable host-facing executable.
- Resolve imports from the source root so the executable runs from the distributed host component without project installation.
- Exclude `__pycache__/`, `.pytest_cache/`, and other generated files from the host component.

This pattern applies to Python embedded in applications, plugins, extensions, hooks, build tools, test tools, and other components whose host remains the unit of distribution.

## Skill resources

Use the skill's `scripts/` directory as the source root:

```text
<skill-name>/
├── SKILL.md
├── references/
│   └── <topic>.md
└── scripts/
    ├── command-name
    ├── package_name/
    │   ├── __init__.py
    │   ├── commands.py
    │   └── ...
    └── tests/
        └── test_package_name.py
```

- Keep `scripts/command-name` as the executable named by `allowed-tools`.
- Keep importable modules in `scripts/package_name/` and tests in `scripts/tests/`.

## Project configuration

Add `pyproject.toml` at the host-component root when the embedded implementation needs dependency, test, formatter, or type-checker configuration. Retain the host's source-root convention.

Use an independent `python/pyproject.toml`, `python/src/`, and `python/tests/` subtree only when the Python component is also built or installed as a separate distribution.
