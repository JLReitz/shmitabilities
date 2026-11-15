"""Explicit-root migration tests."""

import json
from pathlib import Path

import pytest

from knowledge_cli.errors import KnowledgeError
from knowledge_cli.commands import main
from knowledge_cli.migration import apply_migration, plan_migration
from knowledge_cli import migration


def test_moves_sources_tools_and_rewrites_links(tmp_path: Path):
    (tmp_path / "references" / "packages").mkdir(parents=True)
    (tmp_path / "references" / "source.md").write_text("source\n")
    (tmp_path / "references" / "packages" / "tool.md").write_text(
        "[Source](../source.md)\n"
    )
    (tmp_path / "index.md").write_text(
        "[Source](/references/source.md)\n"
        "[Tool](/references/packages/tool.md)\n"
    )
    plan = plan_migration(tmp_path)

    assert not plan.conflicts
    assert (tmp_path / "references" / "source.md").is_file()
    assert not (tmp_path / "sources").exists()

    receipt = apply_migration(plan)

    assert ("references/source.md", "sources/source.md") in receipt
    assert ("references/packages/tool.md", "tools/tool.md") in receipt
    assert "(/sources/source.md)" in (tmp_path / "index.md").read_text()
    assert "(/tools/tool.md)" in (tmp_path / "index.md").read_text()
    assert "(../sources/source.md)" in (
        tmp_path / "tools" / "tool.md"
    ).read_text()
    assert not (tmp_path / "references").exists()


def test_conflicts_prevent_all_mutation(tmp_path: Path):
    (tmp_path / "references").mkdir()
    (tmp_path / "references" / "source.md").write_text("source\n")
    (tmp_path / "vocabulary.ttl").write_text("")
    plan = plan_migration(tmp_path)

    assert plan.conflicts
    with pytest.raises(KnowledgeError):
        apply_migration(plan)

    assert (tmp_path / "references" / "source.md").exists()
    assert not (tmp_path / "sources").exists()


def test_converts_unambiguous_root_ontology(tmp_path: Path):
    prefix = "@prefix ex: <https://example.org/> .\n"
    (tmp_path / "vocabulary.ttl").write_text(
        prefix + "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n"
        "ex:A a owl:Class . ex:B a owl:Class .\n"
    )
    (tmp_path / "requirements.ttl").write_text(
        prefix + "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
        "ex:A rdfs:subClassOf ex:B .\n"
    )
    (tmp_path / "axioms.ttl").write_text("")
    plan = plan_migration(tmp_path)

    assert not plan.conflicts
    assert "Requirement" in plan.ontology

    apply_migration(plan)

    assert (tmp_path / "ontology.ttl").exists()
    assert not (tmp_path / "vocabulary.ttl").exists()


def test_failed_postcheck_restores_original_tree(tmp_path: Path, monkeypatch):
    (tmp_path / "references").mkdir()
    original = tmp_path / "references" / "source.md"
    original.write_text("source\n")
    plan = plan_migration(tmp_path)
    checks = 0
    real_check = migration._verify_result

    def fail_final_check(candidate):
        nonlocal checks
        checks += 1
        if checks == 2:
            raise KnowledgeError("simulated postcheck failure")
        real_check(candidate)

    monkeypatch.setattr(migration, "_verify_result", fail_final_check)

    with pytest.raises(KnowledgeError, match="postcheck failure"):
        apply_migration(plan)

    assert original.read_text() == "source\n"
    assert not (tmp_path / "sources").exists()


def test_rewrites_active_links_without_changing_fenced_examples(tmp_path: Path):
    (tmp_path / "references").mkdir()
    (tmp_path / "references" / "source.md").write_text("source\n")
    (tmp_path / "index.md").write_text(
        '[Source](/references/source.md "title")\n'
        '[named]: </references/source.md> "title"\n'
        '```md\n[example](/references/source.md)\n```\n'
    )
    plan = plan_migration(tmp_path)

    apply_migration(plan)

    result = (tmp_path / "index.md").read_text()
    assert '[Source](/sources/source.md "title")' in result
    assert '[named]: </sources/source.md> "title"' in result
    assert '[example](/references/source.md)' in result


def test_cli_requires_explicit_root_and_reports_before_apply(
    tmp_path: Path, capsys
):
    (tmp_path / "references").mkdir()
    source = tmp_path / "references" / "source.md"
    source.write_text("source\n")

    assert main(["migrate", "--root", str(tmp_path)]) == 0
    report = capsys.readouterr().out

    assert "references/source.md" in report
    assert "sources/source.md" in report
    assert source.exists()
    assert main(["migrate", "--root", str(tmp_path), "--apply"]) == 0
    assert (tmp_path / "sources" / "source.md").exists()


def test_stale_plan_refuses_to_change_tree(tmp_path: Path):
    (tmp_path / "references").mkdir()
    source = tmp_path / "references" / "source.md"
    source.write_text("original\n")
    plan = plan_migration(tmp_path)
    source.write_text("revised\n")

    with pytest.raises(KnowledgeError, match="changed since migration preflight"):
        apply_migration(plan)

    assert source.read_text() == "revised\n"
    assert not (tmp_path / "sources").exists()


def test_receipt_records_changes_after_success(tmp_path: Path):
    (tmp_path / "references").mkdir()
    (tmp_path / "references" / "source.md").write_text("source\n")
    (tmp_path / "index.md").write_text("[Source](/references/source.md)\n")
    plan = plan_migration(tmp_path)

    apply_migration(plan)

    receipt = json.loads((tmp_path / migration.RECEIPT_NAME).read_text())
    assert receipt["moves"] == [["references/source.md", "sources/source.md"]]
    assert receipt["rewrites"] == ["index.md"]
    assert receipt["ontology_converted"] is False
