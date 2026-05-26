from __future__ import annotations

import re
from pathlib import Path

import pytest

from localhost_live.importer import ImportRejectedError
from localhost_live.jsonio import read_json
from localhost_live.registry import InvalidSessionIdError, SessionRegistry


def _write_html(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def test_session_id_uniqueness_and_opacity() -> None:
    ids = {SessionRegistry.generate_session_id() for _ in range(128)}
    assert len(ids) == 128
    assert all(re.fullmatch(r"[0-9a-f]{32}", session_id) for session_id in ids)
    assert all("/" not in session_id and "." not in session_id for session_id in ids)


def test_session_creation_writes_session_metadata_under_sessions_dir(
    tmp_path: Path,
) -> None:
    registry = SessionRegistry(runtime_root=tmp_path / "runtime")
    created = registry.create_session(title="Demo")

    session_dir = tmp_path / "runtime" / "sessions" / created.session_id
    assert created.session_root == session_dir
    assert (session_dir / "session.json").exists()
    assert (session_dir / "manifest.json").exists()
    assert read_json(session_dir / "session.json")["session_id"] == created.session_id


def test_push_appends_monotonic_state_ids(tmp_path: Path) -> None:
    registry = SessionRegistry(runtime_root=tmp_path / "runtime")
    created = registry.create_session()

    file_one = tmp_path / "one.html"
    file_two = tmp_path / "two.html"
    _write_html(file_one, "<html>ONE</html>")
    _write_html(file_two, "<html>TWO</html>")

    push1 = registry.push_state(created.session_id, source=file_one)
    push2 = registry.push_state(created.session_id, source=file_two)

    assert push1.state_id == "000001"
    assert push2.state_id == "000002"
    manifest = read_json(push2.manifest_path)
    assert [state["state_id"] for state in manifest["states"]] == ["000001", "000002"]


def test_replace_latest_replaces_only_latest_and_preserves_ordering(tmp_path: Path) -> None:
    registry = SessionRegistry(runtime_root=tmp_path / "runtime")
    created = registry.create_session()

    _write_html(tmp_path / "one.html", "<html>ONE</html>")
    _write_html(tmp_path / "two.html", "<html>TWO</html>")
    _write_html(tmp_path / "two_replaced.html", "<html>TWO REPLACED</html>")

    registry.push_state(created.session_id, source=tmp_path / "one.html")
    push2 = registry.push_state(created.session_id, source=tmp_path / "two.html")
    replaced = registry.push_state(
        created.session_id,
        source=tmp_path / "two_replaced.html",
        replace_latest=True,
    )

    assert push2.state_id == "000002"
    assert replaced.state_id == "000002"
    manifest = read_json(replaced.manifest_path)
    assert [state["state_id"] for state in manifest["states"]] == ["000001", "000002"]
    assert [state["sequence"] for state in manifest["states"]] == [1, 2]
    assert (created.session_root / "states" / "000002" / "content" / "index.html").read_text(
        encoding="utf-8"
    ) == "<html>TWO REPLACED</html>"


def test_manifest_persists_prior_entries_order_and_source_metadata(tmp_path: Path) -> None:
    registry = SessionRegistry(runtime_root=tmp_path / "runtime")
    created = registry.create_session(title="Manifest Demo")

    dir_source = tmp_path / "site"
    _write_html(dir_source / "index.html", "<html>INDEX</html>")
    _write_html(dir_source / "assets" / "app.js", "console.log('x');")
    _write_html(tmp_path / "file.html", "<html>FILE</html>")

    push1 = registry.push_state(created.session_id, source=dir_source)
    push2 = registry.push_state(
        created.session_id,
        source=tmp_path / "file.html",
        entry="home.html",
    )
    manifest_path = push2.manifest_path

    registry_reloaded = SessionRegistry(runtime_root=tmp_path / "runtime")
    loaded = registry_reloaded.load_manifest(created.session_id)

    assert loaded["state_count"] == 2
    assert [state["state_id"] for state in loaded["states"]] == ["000001", "000002"]
    assert loaded["states"][0]["source"]["source_kind"] == "dir"
    assert loaded["states"][1]["source"]["source_kind"] == "file"
    assert loaded["states"][1]["entry"] == "home.html"
    assert loaded["states"][0]["url"] == f"/s/{created.session_id}/states/000001/"
    assert loaded["states"][1]["url"] == f"/s/{created.session_id}/states/000002/"
    assert read_json(manifest_path) == loaded


def test_replace_latest_failure_keeps_existing_latest_state_intact(tmp_path: Path) -> None:
    registry = SessionRegistry(runtime_root=tmp_path / "runtime")
    created = registry.create_session()

    _write_html(tmp_path / "one.html", "<html>ONE</html>")
    _write_html(tmp_path / "two.html", "<html>TWO</html>")

    registry.push_state(created.session_id, source=tmp_path / "one.html")
    registry.push_state(created.session_id, source=tmp_path / "two.html")
    original_manifest = read_json(created.session_root / "manifest.json")
    latest_content_before = (
        created.session_root / "states" / "000002" / "content" / "index.html"
    ).read_text(encoding="utf-8")

    with pytest.raises(ImportRejectedError):
        registry.push_state(
            created.session_id,
            source=tmp_path / "does-not-exist.html",
            replace_latest=True,
        )

    latest_content_after = (
        created.session_root / "states" / "000002" / "content" / "index.html"
    ).read_text(encoding="utf-8")
    assert latest_content_after == latest_content_before
    assert read_json(created.session_root / "manifest.json") == original_manifest


@pytest.mark.parametrize(
    "session_id",
    ["../escape", "abc", "A" * 32, "g" * 32, "x" * 31, "x" * 33, "abc/def"],
)
def test_invalid_session_ids_are_rejected(tmp_path: Path, session_id: str) -> None:
    registry = SessionRegistry(runtime_root=tmp_path / "runtime")
    _write_html(tmp_path / "one.html", "<html>ONE</html>")

    with pytest.raises(InvalidSessionIdError):
        registry.load_manifest(session_id)
    with pytest.raises(InvalidSessionIdError):
        registry.push_state(session_id, source=tmp_path / "one.html")
