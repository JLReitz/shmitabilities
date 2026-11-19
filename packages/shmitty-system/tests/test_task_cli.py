import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "task-cli"


@pytest.fixture
def workspace(tmp_path):
    home = tmp_path / "home"
    registry = home / ".agents" / "workspaces"
    registry.mkdir(parents=True)
    root = tmp_path / "workspace"
    tasks = root / ".agents" / "tasks"
    tasks.mkdir(parents=True)
    (registry / "test").symlink_to(root, target_is_directory=True)
    return {"home": home, "root": root, "tasks": tasks}


def write_item(
    tasks,
    path,
    *,
    title="Item",
    item_type="task",
    status="created",
    tags=(),
    dependencies=(),
    description="Description.",
    context="",
    extra="",
):
    target = tasks / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "---\n"
        f"title: {title}\n"
        f"type: {item_type}\n"
        f"status: {status}\n"
        f"tags: {json.dumps(list(tags))}\n"
        f"dependencies: {json.dumps(list(dependencies))}\n"
        f"{extra}"
        "---\n\n"
        f"{description}\n\n"
        "---\n\n"
        f"{context}",
        encoding="utf-8",
    )
    return target


def run_cli(workspace, *arguments, cwd=None):
    environment = os.environ.copy()
    environment["HOME"] = str(workspace["home"])
    return subprocess.run(
        [sys.executable, str(SCRIPT), *arguments],
        cwd=cwd or workspace["root"],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def test_ready_reports_created_items_with_done_dependencies(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "done/index.md", title="Done", status="done")
    write_item(
        tasks,
        "ready/index.md",
        title="Ready",
        tags=("step",),
        dependencies=("done/index.md",),
    )
    write_item(tasks, "started/index.md", title="Started", status="started")
    write_item(
        tasks,
        "blocked/index.md",
        title="Blocked",
        dependencies=("started/index.md",),
    )

    result = run_cli(workspace, "ready")

    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout.splitlines() == [
        "path\ttype\ttitle\ttags",
        "ready/index.md\ttask\tReady\tstep",
    ]


def test_ready_scope_filters_results_without_ignoring_external_blockers(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "outside/index.md", status="started")
    write_item(tasks, "epic/index.md", item_type="epic")
    write_item(
        tasks,
        "epic/child/index.md",
        dependencies=("outside/index.md",),
    )
    write_item(tasks, "other/index.md", title="Other")

    result = run_cli(workspace, "ready", "--scope", "epic/index.md")

    assert result.returncode == 0
    assert result.stdout.splitlines() == [
        "path\ttype\ttitle\ttags",
        "epic/index.md\tepic\tItem\t",
    ]


def test_show_scope_keeps_relationships_crossing_its_boundary(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "outside/index.md", title="Outside", status="done")
    write_item(tasks, "epic/index.md", title="Epic", item_type="epic")
    write_item(
        tasks,
        "epic/child/index.md",
        title="Child",
        dependencies=("outside/index.md",),
    )

    result = run_cli(
        workspace,
        "show",
        "epic/child/index.md",
        "--scope",
        "epic/index.md",
    )

    assert result.returncode == 0
    assert result.stdout == """# Child

- Path: `epic/child/index.md`
- Type: `task`
- Status: `created`
- Tags: (none)
- Parent: `epic/index.md`

## Children

- (none)

## Dependencies

- `outside/index.md`

## Dependents

- (none)

## Description

Description.

## Context

"""


def test_show_rejects_item_outside_scope(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "epic/index.md", item_type="epic")
    write_item(tasks, "outside/index.md")

    result = run_cli(
        workspace,
        "show",
        "outside/index.md",
        "--scope",
        "epic/index.md",
    )

    assert result.returncode == 1
    assert result.stdout == ""
    assert "outside the selected scope" in result.stderr


def test_search_matches_casefolded_title_and_tags_once(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "z/index.md", title="Straße", tags=("STRASSE",))
    write_item(tasks, "a/index.md", title="Alpha", tags=("street",))

    result = run_cli(workspace, "search", "strasse")

    assert result.returncode == 0
    assert result.stdout.splitlines() == [
        "path\ttype\tstatus\ttitle\ttags\tmatched_fields",
        "z/index.md\ttask\tcreated\tStraße\tSTRASSE\ttitle,tags",
    ]


def test_search_without_matches_writes_only_header(workspace):
    write_item(workspace["tasks"], "item/index.md")

    result = run_cli(workspace, "search", "absent")

    assert result.returncode == 0
    assert result.stdout.splitlines() == [
        "path\ttype\tstatus\ttitle\ttags\tmatched_fields",
    ]


def test_previous_uses_direct_markdown_files_and_returns_all_latest_ties(workspace):
    tasks = workspace["tasks"]
    first = write_item(tasks, "a/index.md", title="A")
    supporting = tasks / "a" / "design.md"
    supporting.write_text("Design", encoding="utf-8")
    second = write_item(tasks, "a/child/index.md", title="Child")
    third = write_item(tasks, "b/index.md", title="B")
    os.utime(first, ns=(10, 10))
    os.utime(second, ns=(20, 20))
    os.utime(supporting, ns=(30, 30))
    os.utime(third, ns=(30, 30))

    result = run_cli(workspace, "previous")

    assert result.returncode == 0
    assert result.stdout.startswith("<!-- task-cli previous: a/index.md -->\n")
    assert "<!-- task-cli previous: b/index.md -->\n" in result.stdout
    assert "<!-- task-cli previous: a/child/index.md -->" not in result.stdout


def test_previous_scope_limits_candidate_levels(workspace):
    tasks = workspace["tasks"]
    scoped = write_item(tasks, "epic/index.md", title="Epic", item_type="epic")
    outside = write_item(tasks, "outside/index.md", title="Outside")
    os.utime(scoped, ns=(10, 10))
    os.utime(outside, ns=(20, 20))

    result = run_cli(workspace, "previous", "--scope", "epic/index.md")

    assert result.returncode == 0
    assert "Epic" in result.stdout
    assert "Outside" not in result.stdout


@pytest.mark.parametrize(
    ("path", "replacement", "message"),
    [
        ("bad/index.md", "type: task", "title"),
        ("bad/index.md", "type: invalid", "type"),
        ("bad/index.md", "status: invalid", "status"),
        ("bad/index.md", "tags: [one, one]", "tags"),
        ("bad/index.md", "dependencies: [missing/index.md]", "dependencies"),
    ],
)
def test_invalid_item_prevents_partial_results(workspace, path, replacement, message):
    item = write_item(workspace["tasks"], path)
    text = item.read_text(encoding="utf-8")
    key = replacement.split(":", 1)[0]
    text = "\n".join(
        replacement if line.startswith(f"{key}:") else line
        for line in text.splitlines()
    )
    item.write_text(text, encoding="utf-8")

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert path in result.stderr
    assert message in result.stderr


def test_root_index_is_forbidden(workspace):
    write_item(workspace["tasks"], "index.md")

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert ".agents/tasks/index.md" in result.stderr


@pytest.mark.parametrize(
    ("extra", "description", "message"),
    [
        ("unknown: true\n", "Description.", "unknown"),
        ("title: Duplicate\n", "Description.", "duplicate"),
        ("", "", "description"),
    ],
)
def test_frontmatter_and_body_shape_are_strict(
    workspace,
    extra,
    description,
    message,
):
    write_item(
        workspace["tasks"],
        "bad/index.md",
        extra=extra,
        description=description,
    )

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert message in result.stderr.casefold()


@pytest.mark.parametrize(
    ("dependency", "message"),
    [
        ("/absolute/index.md", "relative"),
        ("../escape/index.md", "dot"),
        ("./other/index.md", "dot"),
        ("item/index.md", "self"),
    ],
)
def test_dependency_paths_reject_nonidentities(workspace, dependency, message):
    write_item(
        workspace["tasks"],
        "item/index.md",
        dependencies=(dependency,),
    )

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert message in result.stderr.casefold()


def test_duplicate_dependencies_are_invalid(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "blocker/index.md", status="done")
    write_item(
        tasks,
        "item/index.md",
        dependencies=("blocker/index.md", "blocker/index.md"),
    )

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert "duplicate" in result.stderr.casefold()


def test_symlinked_item_directory_is_invalid(workspace, tmp_path):
    external = tmp_path / "external"
    external.mkdir()
    write_item(external, "index.md")
    (workspace["tasks"] / "linked").symlink_to(external, target_is_directory=True)

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert "symlink" in result.stderr.casefold()


def test_dependency_cycles_are_reported_without_normal_output(workspace):
    tasks = workspace["tasks"]
    write_item(tasks, "a/index.md", dependencies=("b/index.md",))
    write_item(tasks, "b/index.md", dependencies=("a/index.md",))

    result = run_cli(workspace, "ready")

    assert result.returncode == 1
    assert result.stdout == ""
    assert "cycle" in result.stderr.casefold()


def test_previous_empty_graph_is_an_operational_error(workspace):
    result = run_cli(workspace, "previous")

    assert result.returncode == 1
    assert result.stdout == ""
    assert "task" in result.stderr.casefold()


def test_no_registered_workspace_is_an_operational_error(tmp_path):
    home = tmp_path / "home"
    cwd = tmp_path / "cwd"
    home.mkdir()
    cwd.mkdir()
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "ready"],
        cwd=cwd,
        env={**os.environ, "HOME": str(home)},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert result.stdout == ""
    assert "register" in result.stderr.casefold()


def test_help_succeeds_and_usage_errors_return_two(workspace):
    help_result = run_cli(workspace, "--help")
    usage_result = run_cli(workspace, "show")

    assert help_result.returncode == 0
    assert help_result.stderr == ""
    assert usage_result.returncode == 2
    assert usage_result.stdout == ""
