from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import localhost_live.replay as replay_module
from localhost_live.registry import SessionRegistry


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"


def _run_module_command(args: list[str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(SRC_DIR) if not existing else f"{SRC_DIR}{os.pathsep}{existing}"
    return subprocess.run(
        [sys.executable, "-m", "localhost_live", *args],
        cwd=PROJECT_ROOT,
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )


def _create_two_state_session(runtime_root: Path, tmp_path: Path) -> str:
    registry = SessionRegistry(runtime_root=runtime_root)
    first_source_dir = tmp_path / "site"
    (first_source_dir / "assets").mkdir(parents=True)
    (first_source_dir / "index.html").write_text(
        "<html><body>first state</body></html>", encoding="utf-8"
    )
    (first_source_dir / "assets" / "app.js").write_text(
        "console.log('first');", encoding="utf-8"
    )
    second_source_file = tmp_path / "second.html"
    second_source_file.write_text("<html><body>second state</body></html>", encoding="utf-8")

    created = registry.create_session(
        title="Replay Demo",
        source=first_source_dir,
    )
    registry.push_state(created.session_id, source=second_source_file)
    return created.session_id


def test_save_writes_replay_artifact_structure(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    session_id = _create_two_state_session(runtime_root, tmp_path)

    saved = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert saved.returncode == 0, saved.stderr
    payload = json.loads(saved.stdout)
    assert payload["state_count"] == 2
    assert payload["destination"] == str(destination.resolve())

    assert (destination / "index.html").exists()
    assert (destination / "liveview.session.json").exists()
    assert (destination / "states" / "000001" / "content" / "index.html").exists()
    assert (destination / "states" / "000001" / "content" / "assets" / "app.js").exists()
    assert (destination / "states" / "000002" / "content" / "index.html").exists()
    assert "first state" in (
        destination / "states" / "000001" / "content" / "index.html"
    ).read_text(encoding="utf-8")
    assert "second state" in (
        destination / "states" / "000002" / "content" / "index.html"
    ).read_text(encoding="utf-8")


def test_save_preserves_order_metadata_and_static_bootstrap(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    session_id = _create_two_state_session(runtime_root, tmp_path)

    saved = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert saved.returncode == 0, saved.stderr

    replay_manifest = json.loads(
        (destination / "liveview.session.json").read_text(encoding="utf-8")
    )
    assert replay_manifest["session_id"] == session_id
    assert replay_manifest["title"] == "Replay Demo"
    assert replay_manifest["session"]["title"] == "Replay Demo"
    assert [state["state_id"] for state in replay_manifest["states"]] == [
        "000001",
        "000002",
    ]
    assert [state["sequence"] for state in replay_manifest["states"]] == [1, 2]
    assert replay_manifest["states"][0]["url"] == "states/000001/content/index.html"
    assert replay_manifest["states"][1]["url"] == "states/000002/content/index.html"

    shell_html = (destination / "index.html").read_text(encoding="utf-8")
    assert 'data-manifest-url="liveview.session.json"' in shell_html
    assert "data-events-url=" not in shell_html
    assert '<script defer src="shell.js"></script>' in shell_html
    assert '<link rel="stylesheet" href="shell.css">' in shell_html

    first_state_url = replay_manifest["states"][0]["url"]
    assert "first state" in (destination / first_state_url).read_text(encoding="utf-8")


def test_save_refuses_non_empty_destination_unless_force(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    session_source = tmp_path / "index.html"
    session_source.write_text("<html>single</html>", encoding="utf-8")
    destination = tmp_path / "artifact"
    destination.mkdir(parents=True)
    (destination / "existing.txt").write_text("keep", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    created = registry.create_session(source=session_source)
    session_id = created.session_id

    rejected = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert rejected.returncode != 0
    assert "Destination is non-empty" in rejected.stderr
    assert (destination / "existing.txt").exists()

    forced = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--force",
            "--json",
        ]
    )
    assert forced.returncode == 0, forced.stderr
    assert not (destination / "existing.txt").exists()
    assert (destination / "index.html").exists()


def test_save_json_output_contract(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    session_id = registry.create_session(source=source).session_id

    saved = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert saved.returncode == 0, saved.stderr
    payload = json.loads(saved.stdout)
    assert payload["ok"] is True
    assert payload["command"] == "save"
    assert payload["session_id"] == session_id
    assert payload["destination"] == str(destination.resolve())
    assert payload["state_count"] == 1


def test_save_rejects_tampered_manifest_state_id_traversal(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    session_id = registry.create_session(source=source).session_id
    manifest_path = registry.session_root(session_id) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["states"][0]["state_id"] = "../evil"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    rejected = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert rejected.returncode != 0
    assert "Invalid manifest state entry: state_id" in rejected.stderr


@pytest.mark.parametrize("entry", ["/etc/passwd", "../index.html"])
def test_save_rejects_tampered_manifest_entry_paths(
    tmp_path: Path, entry: str
) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    session_id = registry.create_session(source=source).session_id
    manifest_path = registry.session_root(session_id) / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["states"][0]["entry"] = entry
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    rejected = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert rejected.returncode != 0
    assert "Invalid manifest state entry: entry" in rejected.stderr


def test_save_force_rejects_filesystem_root_destination(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    session_id = registry.create_session(source=source).session_id

    rejected = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "save",
            session_id,
            "--to",
            "/",
            "--force",
            "--json",
        ]
    )
    assert rejected.returncode != 0
    assert "Refusing to overwrite filesystem root with --force" in rejected.stderr


def test_save_refuses_late_destination_creation_without_force(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    session_id = registry.create_session(source=source).session_id

    original_stage = replay_module.stage_replay_artifact

    def _stage_with_late_destination(
        *, registry: SessionRegistry, session_id: str, stage_root: str | Path
    ) -> replay_module.ReplayStageResult:
        staged = original_stage(
            registry=registry,
            session_id=session_id,
            stage_root=stage_root,
        )
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "raced.txt").write_text("raced", encoding="utf-8")
        return staged

    monkeypatch.setattr(
        replay_module,
        "stage_replay_artifact",
        _stage_with_late_destination,
    )

    with pytest.raises(ValueError, match="Destination appeared during commit"):
        replay_module.save_replay_artifact(
            registry=registry,
            session_id=session_id,
            destination=destination,
            force=False,
        )
    assert (destination / "raced.txt").read_text(encoding="utf-8") == "raced"


def test_save_refuses_existing_empty_destination_without_force(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact"
    destination.mkdir(parents=True)
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    registry = SessionRegistry(runtime_root=runtime_root)
    session_id = registry.create_session(source=source).session_id
    with pytest.raises(ValueError, match="Destination exists, pass --force"):
        replay_module.save_replay_artifact(
            registry=registry,
            session_id=session_id,
            destination=destination,
            force=False,
        )
