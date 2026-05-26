from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SKILL_PATH = REPO_ROOT / "skills" / "live-view" / "SKILL.md"

REQUIRED_COMMAND_STRINGS = (
    "localhost-live session create",
    "localhost-live push",
    "localhost-live url",
    "localhost-live status",
    "localhost-live save",
    "localhost-live export",
    "localhost-live stop",
)

REQUIRED_WORKFLOW_PHRASES = (
    "Generate or update the artifact",
    "report the live URL once",
    "Push subsequent revisions in chronological order",
    "only when requested or when persistence/hand-off is useful",
)

REQUIRED_PREREQUISITE_PHRASES = (
    "Python 3.11 or newer",
    "no third-party Python runtime packages",
    "./bin/localhost-live",
    "no install or dependency bootstrap step is required",
    "pytest>=8.0.0",
)

FORBIDDEN_SKILL_GUIDANCE_SNIPPETS = (
    "edit .codex-plugin/plugin.json",
    "directly edit plugin.json",
    "control.token",
    "manually edit the token",
)


def test_live_view_skill_exists() -> None:
    assert SKILL_PATH.exists()
    assert SKILL_PATH.is_file()


def test_live_view_skill_includes_canonical_commands_and_workflow() -> None:
    text = SKILL_PATH.read_text(encoding="utf-8")

    for command in REQUIRED_COMMAND_STRINGS:
        assert command in text

    for phrase in REQUIRED_WORKFLOW_PHRASES:
        assert phrase in text

    for phrase in REQUIRED_PREREQUISITE_PHRASES:
        assert phrase in text


def test_live_view_skill_excludes_unsafe_guidance() -> None:
    text = SKILL_PATH.read_text(encoding="utf-8")
    lower_text = text.lower()

    for snippet in FORBIDDEN_SKILL_GUIDANCE_SNIPPETS:
        assert snippet not in lower_text

    # Reject user-specific absolute home paths such as /home/alice.
    assert "/home/" not in lower_text
