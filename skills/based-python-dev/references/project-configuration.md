# Python project configuration

Use `pyproject.toml` as the baseline configuration file. Apply this template when initializing a project, replace each placeholder, and remove optional sections that the project does not use:

```toml
[project]
name = "project-name"
version = "0.1.0"
description = "Short project description."
readme = "README.md"
requires-python = ">=3.9"
dependencies = [
    "package>=...",
]

[project.optional-dependencies]
dev = [
    "pytest>=...",
]
cli = ["click"]
gui = ["package>=..."]

[project.scripts]
command-name = "package.module:main"

[build-system]
requires = ["setuptools>=..."]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- Record runtime dependencies in the `dependencies` field under `[project]` and optional dependency groups in `[project.optional-dependencies]`.
- Declare command-line entry points in `[project.scripts]`.
- Keep tool configuration in `pyproject.toml` where the tool supports it.
- Preserve the project lockfile when one exists.
