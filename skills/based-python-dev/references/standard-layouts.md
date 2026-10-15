# Standard Python package layouts

## Default package layout

Use the `src/` layout for new installable packages:

```text
project-name/
├── pyproject.toml
├── README.md
├── LICENSE
├── src/
│   └── package_name/
│       ├── __init__.py
│       ├── module.py
│       └── subpackage/
│           ├── __init__.py
│           └── module.py
└── tests/
    ├── test_module.py
    └── test_subpackage.py
```

- Put importable code under `src/package_name/`.
- Use the normalized distribution name for the repository and `[project].name`.
- Use a valid Python identifier for the import package. Replace hyphens with underscores.
- Keep tests outside the import package.
- Include `__init__.py` in regular packages and subpackages.

For an isolated package in a larger repository, apply the complete layout within the package directory. Each package MUST contain its own `pyproject.toml`, metadata, dependencies, tests, and documentation, and MUST build and install from its own directory.

```text
repository/
└── packages/
    └── project-name/
        ├── pyproject.toml
        ├── README.md
        ├── src/
        │   └── package_name/
        │       └── __init__.py
        └── tests/
            └── test_package_name.py
```

Declare dependencies on sibling packages explicitly. Keep repository-root configuration for shared automation and repository-wide policy.

## Command-line application

Separate terminal interaction from reusable behavior:

```text
project-name/
├── pyproject.toml
├── README.md
├── LICENSE
├── src/
│   └── package_name/
│       ├── __init__.py
│       ├── __main__.py
│       ├── cli.py
│       └── core.py
└── tests/
    ├── test_cli.py
    └── test_core.py
```

- Put argument parsing and terminal interaction in `cli.py`.
- Put reusable behavior in `core.py` or domain-specific modules.
- Use `__main__.py` for `python3 -m package_name`.
- Declare installed commands in `[project.scripts]`.

## Single-module distribution

Use one module when it contains the complete public interface:

```text
project-name/
├── pyproject.toml
├── README.md
├── LICENSE
├── src/
│   └── module_name.py
└── tests/
    └── test_module_name.py
```

Convert the module to a regular package when the implementation needs multiple modules.

## Namespace package

Use a native namespace package only when separate distributions contribute packages under one shared namespace:

```text
project-name/
├── pyproject.toml
├── README.md
├── LICENSE
├── src/
│   └── namespace_name/
│       └── package_name/
│           ├── __init__.py
│           └── module.py
└── tests/
    └── test_module.py
```

Omit `namespace_name/__init__.py`. Include `__init__.py` in each regular child package.
