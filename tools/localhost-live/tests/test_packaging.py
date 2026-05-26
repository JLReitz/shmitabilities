from __future__ import annotations

import tomllib
from pathlib import Path


def test_console_script_declared_in_pyproject() -> None:
    pyproject_path = Path(__file__).resolve().parents[1] / "pyproject.toml"
    data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))

    scripts = data["project"]["scripts"]
    assert scripts["localhost-live"] == "localhost_live.cli:main"
