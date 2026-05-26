from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
LAUNCHER_PATH = REPO_ROOT / "bin" / "localhost-live"


def test_repo_launcher_exists() -> None:
    assert LAUNCHER_PATH.exists()
    assert LAUNCHER_PATH.is_file()


def test_repo_launcher_runs_help_without_pythonpath_setup() -> None:
    result = subprocess.run(
        [sys.executable, str(LAUNCHER_PATH), "--help"],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "localhost-live" in result.stdout
    assert "session" in result.stdout
