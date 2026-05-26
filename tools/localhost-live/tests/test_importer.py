from __future__ import annotations

from pathlib import Path

import pytest

import localhost_live.importer as importer
from localhost_live.importer import ImportLimits, ImportRejectedError, import_state_source
from localhost_live.jsonio import read_json


def _state_root(tmp_path: Path, state_id: str = "000001") -> Path:
    root = tmp_path / "states" / state_id
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_file_snapshot_defaults_to_index_html(tmp_path: Path) -> None:
    state_root = _state_root(tmp_path)
    source_file = tmp_path / "source.html"
    source_file.write_text("<html>FILE SNAPSHOT</html>", encoding="utf-8")

    result = import_state_source(source_file, state_root)

    assert result.entry == "index.html"
    assert (state_root / "content" / "index.html").read_text(
        encoding="utf-8"
    ) == "<html>FILE SNAPSHOT</html>"
    assert read_json(state_root / "state.json")["entry"] == "index.html"
    source = read_json(state_root / "source.json")
    assert source["source_kind"] == "file"
    assert source["entry"] == "index.html"
    assert source["rejected"] == []


def test_dir_snapshot_copies_contents_with_index_entry(tmp_path: Path) -> None:
    state_root = _state_root(tmp_path)
    source_dir = tmp_path / "srcdir"
    (source_dir / "assets").mkdir(parents=True)
    (source_dir / "index.html").write_text("<html>DIR SNAPSHOT</html>", encoding="utf-8")
    (source_dir / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8")

    result = import_state_source(source_dir, state_root)

    assert result.entry == "index.html"
    assert (state_root / "content" / "index.html").read_text(
        encoding="utf-8"
    ) == "<html>DIR SNAPSHOT</html>"
    assert (state_root / "content" / "assets" / "app.js").read_text(
        encoding="utf-8"
    ) == "console.log('ok');"
    assert read_json(state_root / "state.json")["entry"] == "index.html"


def test_non_default_entry_is_supported_and_recorded(tmp_path: Path) -> None:
    state_root = _state_root(tmp_path)
    source_dir = tmp_path / "site"
    source_dir.mkdir()
    (source_dir / "home.html").write_text("<html>HOME</html>", encoding="utf-8")
    (source_dir / "index.html").write_text("<html>INDEX</html>", encoding="utf-8")

    result = import_state_source(source_dir, state_root, entry="home.html")

    assert result.entry == "home.html"
    assert read_json(state_root / "state.json")["entry"] == "home.html"
    assert read_json(state_root / "source.json")["entry"] == "home.html"


def test_rejects_disallowed_inputs_and_records_diagnostics(tmp_path: Path) -> None:
    limits = ImportLimits(max_total_bytes=128, max_file_bytes=64)
    source_dir = tmp_path / "srcdir"
    source_dir.mkdir()
    (source_dir / "index.html").write_text("<html>OK</html>", encoding="utf-8")

    disallowed_files = [
        source_dir / ".hidden",
        source_dir / ".env",
        source_dir / ".git" / "config",
        source_dir / "api_secret.txt",
        source_dir / "big.bin",
    ]
    (source_dir / ".git").mkdir(exist_ok=True)
    disallowed_files[0].write_text("hidden", encoding="utf-8")
    disallowed_files[1].write_text("env", encoding="utf-8")
    disallowed_files[2].write_text("git config", encoding="utf-8")
    disallowed_files[3].write_text("secret", encoding="utf-8")
    disallowed_files[4].write_bytes(b"x" * 90)

    escape_target = tmp_path / "escape.txt"
    escape_target.write_text("escape", encoding="utf-8")
    (source_dir / "escape-link").symlink_to(escape_target)

    state_root = _state_root(tmp_path)
    with pytest.raises(ImportRejectedError) as excinfo:
        import_state_source(source_dir, state_root, limits=limits)

    diagnostics = excinfo.value.diagnostics
    assert any("dotfile" in item for item in diagnostics)
    assert any(".env" in item for item in diagnostics)
    assert any(".git" in item for item in diagnostics)
    assert any("secret-like" in item for item in diagnostics)
    assert any("symlink-escape" in item for item in diagnostics)
    assert any("oversize-file" in item or "oversize-total" in item for item in diagnostics)

    source = read_json(state_root / "source.json")
    assert source["source_kind"] == "dir"
    assert source["entry"] == "index.html"
    assert source["rejected"] == diagnostics
    assert not (state_root / "content").exists()


def test_rejects_entry_traversal_and_never_generates_directory_listing(tmp_path: Path) -> None:
    state_root = _state_root(tmp_path)
    source_dir = tmp_path / "srcdir"
    source_dir.mkdir()
    (source_dir / "about.html").write_text("<html>ABOUT</html>", encoding="utf-8")

    with pytest.raises(ImportRejectedError) as traversal_exc:
        import_state_source(source_dir, state_root, entry="../escape.html")
    assert any("entry-traversal" in item for item in traversal_exc.value.diagnostics)
    assert not (state_root / "content").exists()

    state_root2 = _state_root(tmp_path, state_id="000002")
    with pytest.raises(ImportRejectedError) as missing_entry_exc:
        import_state_source(source_dir, state_root2)
    assert any("missing-entry" in item for item in missing_entry_exc.value.diagnostics)
    assert not (state_root2 / "content").exists()
    assert not (state_root2 / "content" / "index.html").exists()


def test_file_mode_rejects_disallowed_parent_segments(tmp_path: Path) -> None:
    source_parent = tmp_path / ".hidden-parent"
    source_parent.mkdir()
    source_file = source_parent / "index.html"
    source_file.write_text("<html>HIDDEN PARENT</html>", encoding="utf-8")

    state_root = _state_root(tmp_path, state_id="000003")
    with pytest.raises(ImportRejectedError) as excinfo:
        import_state_source(source_file, state_root)

    diagnostics = excinfo.value.diagnostics
    assert any("dotfile" in item for item in diagnostics)
    assert not (state_root / "content").exists()


def test_dir_copy_rejects_source_changed_between_plan_and_copy(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source_dir = tmp_path / "srcdir"
    source_dir.mkdir()
    source_file = source_dir / "index.html"
    source_file.write_text("<html>ORIGINAL</html>", encoding="utf-8")

    state_root = _state_root(tmp_path, state_id="000004")
    original_copy = importer._copy_planned_file
    replaced = False

    def race_copy(plan_item: importer.PlannedFile, destination_path: Path) -> None:
        nonlocal replaced
        if not replaced and plan_item.relative_path.as_posix() == "index.html":
            replacement = source_dir / "replacement.html"
            replacement.write_text("<html>REPLACED</html>", encoding="utf-8")
            replacement.replace(source_file)
            replaced = True
        original_copy(plan_item, destination_path)

    monkeypatch.setattr(importer, "_copy_planned_file", race_copy)

    with pytest.raises(ImportRejectedError) as excinfo:
        import_state_source(source_dir, state_root)

    assert any("source-changed:index.html" in item for item in excinfo.value.diagnostics)
    assert not (state_root / "content").exists()
    source = read_json(state_root / "source.json")
    assert any("source-changed:index.html" in item for item in source["rejected"])
