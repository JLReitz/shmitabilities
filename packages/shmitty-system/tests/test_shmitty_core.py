import importlib
import json
import sys
from pathlib import Path

import pytest


BIN = Path(__file__).resolve().parents[1] / "bin"
CASES = Path(__file__).parent / "fixtures" / "workspace-context-cases.json"
sys.path.insert(0, str(BIN))


def load_core(name):
    return importlib.import_module(f"shmitty_core.{name}")


def test_frontmatter_reports_duplicate_keys_without_losing_body(tmp_path):
    document = tmp_path / "index.md"
    document.write_text(
        "---\ntitle: First\ntitle: Second\ntags: []\n---\n\nBody\n",
        encoding="utf-8",
    )

    parsed = load_core("frontmatter").load_frontmatter(document)

    assert parsed.metadata == {"title": "Second", "tags": []}
    assert parsed.duplicate_keys == ("title",)
    assert parsed.body == "\nBody\n"


def test_tsv_removes_cell_control_characters():
    tsv = load_core("tsv")

    assert tsv.row(("a\tb", "c\r\nd", "`e`")) == "a b\tc  d\te"


@pytest.mark.parametrize("case", json.loads(CASES.read_text(encoding="utf-8")))
def test_workspace_resolution_matches_shared_cases(tmp_path, case):
    home = tmp_path / "home"
    home.mkdir()
    cwd = tmp_path.joinpath(*case["cwd"])
    cwd.mkdir(parents=True)
    registry = home / ".agents" / "workspaces"
    if case["registry"] is not None:
        registry.mkdir(parents=True)
        for entry in case["registry"]:
            link = registry / entry["name"]
            if entry["kind"] == "directory":
                link.mkdir()
                continue
            target = tmp_path.joinpath(*entry["target"])
            target.mkdir(parents=True, exist_ok=True)
            value = target
            if entry["relative"]:
                value = Path("..").joinpath("..", "..", *entry["target"])
            link.symlink_to(value, target_is_directory=True)

    result = load_core("workspace").find_workspace(cwd, home)

    expected = (
        None if case["expected"] is None
        else tmp_path.joinpath(*case["expected"])
    )
    assert result == expected
