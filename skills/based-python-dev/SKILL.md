---
name: based-python-dev
description: Initialize and maintain Python projects with the baseline pyproject.toml layout, Python 3.9 compatibility, PEP 8 code, and human-facing documentation conventions. Use when creating or modifying Python project configuration, source code, docstrings, or annotations.
---

# Based Python development

Apply the `based-software-dev` skill to Python design and implementation.

## Style

- Python code MUST conform to PEP 8.
- Docstrings MUST conform to PEP 257 and [Python API documentation](references/api-documentation.md).

### Formatting

- Format Python with Ruff.
- Run `ruff format .` to write formatting changes and `ruff format --check .` to check formatting.
- Retain Black in an existing Black-formatted project until the project approves migration to Ruff.

## Python compatibility

- Python projects MUST support Python 3.9 and later.
- Set `requires-python = ">=3.9"` in `pyproject.toml`.
- Use syntax and standard-library features available in Python 3.9 unless the project states a newer minimum version.

## Project configuration

Apply [Python project configuration](references/project-configuration.md) when creating or modifying `pyproject.toml`.

## Package layout

- For installable packages, select a layout from [Standard Python package layouts](references/standard-layouts.md).
- For Python embedded in another component, apply [Embedded Python layout](references/embedded-layout.md).

## Tests

- Use pytest.
- Name test files `test_*.py`.
- Implement data-driven cases with `pytest.mark.parametrize`.
- Use pytest fixtures for shared setup and dependencies.
