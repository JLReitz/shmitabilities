---
name: based-python-dev
description: Initialize and maintain Python projects with the baseline pyproject.toml layout, Python 3.9 compatibility, PEP 8 code, and human-facing documentation conventions. Use when creating or modifying Python project configuration, source code, docstrings, or annotations.
---

# Based Python development

## Python compatibility

- Python projects MUST support Python 3.9 and later.
- Set `requires-python = ">=3.9"` in `pyproject.toml`.
- Use syntax and standard-library features available in Python 3.9 unless the project states a newer minimum version.

## Project configuration

Apply [Python project configuration](references/project-configuration.md) when creating or modifying `pyproject.toml`.

## Python source

- Python code MUST conform to PEP 8.
- Prose in docstrings and annotations MUST conform to the `based-document-author` skill's human-facing conventions. PEP 8 controls source-code line lengths.
- Apply the `based-oop-dev` skill to object-oriented Python design and implementation.
- For installable packages, select a layout from [Standard Python package layouts](references/standard-layouts.md).
- For Python embedded in another component, apply [Embedded Python layout](references/embedded-layout.md).
