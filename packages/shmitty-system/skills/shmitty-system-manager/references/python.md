# Python packages

Use `python3` as the default interpreter. Use the `based-python-dev` skill when creating or modifying a Python project.

For a project installation, request approval before creating a virtual environment. Confirm `python3-full` is installed, create `.venv` at the project root with `python3 -m venv .venv`, and use that environment's `bin/python` and `bin/pip`.

For a system-wide installation, first try the Debian package `python3-<package>` through apt. For a non-Debian packaged Python application, try its name without the `python-` prefix through the applicable package managers. Use pipx for an application that requires Python when the earlier routes do not apply; confirm pipx is installed and obtain approval before using it.

See `/usr/share/doc/python3.12/README.venv` when the host provides it.
