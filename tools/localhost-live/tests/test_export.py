from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath

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
    session_id = registry.create_session(
        title="Export Demo",
        source=first_source_dir,
    ).session_id
    registry.push_state(session_id, source=second_source_file)
    return session_id


def _read_zip_text(archive: Path, entry_name: str) -> str:
    with zipfile.ZipFile(archive, "r") as zf:
        with zf.open(entry_name, "r") as handle:
            return io.TextIOWrapper(handle, encoding="utf-8").read()


def _archive_names(archive: Path) -> list[str]:
    with zipfile.ZipFile(archive, "r") as zf:
        return zf.namelist()


def test_export_writes_replayable_archive_structure(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact.liveview.zip"
    session_id = _create_two_state_session(runtime_root, tmp_path)

    exported = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "export",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert exported.returncode == 0, exported.stderr
    payload = json.loads(exported.stdout)
    assert payload["ok"] is True
    assert payload["command"] == "export"
    assert payload["session_id"] == session_id
    assert payload["destination"] == str(destination.resolve())
    assert payload["state_count"] == 2
    assert destination.exists()

    names = _archive_names(destination)
    assert "index.html" in names
    assert "liveview.session.json" in names
    assert "shell.css" in names
    assert "shell.js" in names
    assert "states/000001/content/index.html" in names
    assert "states/000001/content/assets/app.js" in names
    assert "states/000002/content/index.html" in names

    manifest = json.loads(_read_zip_text(destination, "liveview.session.json"))
    assert manifest["session_id"] == session_id
    assert manifest["state_count"] == 2
    for state in manifest["states"]:
        assert state["url"] in names

    shell_html = _read_zip_text(destination, "index.html")
    assert 'data-manifest-url="liveview.session.json"' in shell_html
    assert "first state" in _read_zip_text(destination, "states/000001/content/index.html")
    assert "second state" in _read_zip_text(destination, "states/000002/content/index.html")


def test_export_archive_names_are_safe_and_ordered(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact.liveview.zip"
    session_id = _create_two_state_session(runtime_root, tmp_path)

    exported = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "export",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert exported.returncode == 0, exported.stderr

    names = _archive_names(destination)
    assert names == sorted(names)
    for name in names:
        entry = PurePosixPath(name)
        assert not entry.is_absolute()
        assert all(part not in {"", ".", ".."} for part in entry.parts)


def test_export_is_deterministic_for_same_session(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    first_archive = tmp_path / "first.liveview.zip"
    second_archive = tmp_path / "second.liveview.zip"
    session_id = _create_two_state_session(runtime_root, tmp_path)

    first = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "export",
            session_id,
            "--to",
            str(first_archive),
            "--json",
        ]
    )
    assert first.returncode == 0, first.stderr

    second = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "export",
            session_id,
            "--to",
            str(second_archive),
            "--json",
        ]
    )
    assert second.returncode == 0, second.stderr

    assert _archive_names(first_archive) == _archive_names(second_archive)
    assert first_archive.read_bytes() == second_archive.read_bytes()


def test_export_refuses_overwrite_unless_force(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact.liveview.zip"
    destination.write_text("existing", encoding="utf-8")
    source = tmp_path / "index.html"
    source.write_text("<html>single</html>", encoding="utf-8")
    session_id = SessionRegistry(runtime_root=runtime_root).create_session(source=source).session_id

    rejected = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "export",
            session_id,
            "--to",
            str(destination),
            "--json",
        ]
    )
    assert rejected.returncode != 0
    assert "Destination exists, pass --force to overwrite" in rejected.stderr
    assert destination.read_text(encoding="utf-8") == "existing"

    forced = _run_module_command(
        [
            "--runtime-root",
            str(runtime_root),
            "export",
            session_id,
            "--to",
            str(destination),
            "--force",
            "--json",
        ]
    )
    assert forced.returncode == 0, forced.stderr
    names = _archive_names(destination)
    assert "index.html" in names
    assert "liveview.session.json" in names


def test_export_refuses_late_destination_creation_without_force(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_root = tmp_path / "runtime"
    destination = tmp_path / "artifact.liveview.zip"
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
        destination.write_text("raced", encoding="utf-8")
        return staged

    monkeypatch.setattr(
        replay_module,
        "stage_replay_artifact",
        _stage_with_late_destination,
    )

    with pytest.raises(ValueError, match="Destination appeared during commit"):
        replay_module.export_replay_archive(
            registry=registry,
            session_id=session_id,
            destination=destination,
            force=False,
        )
    assert destination.read_text(encoding="utf-8") == "raced"
