import argparse
import sys
from pathlib import Path

from .errors import KnowledgeError
from .migration import apply_migration, plan_migration
from .operations import (
    confidence_report,
    connections_report,
    investment_report,
    ontology_report,
    read_report,
    search_report,
    select_root,
    verification_reports,
)
from .tsv import row


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="knowledge-cli")
    subcommands = result.add_subparsers(dest="command", required=True)

    def add_root(command):
        command.add_argument(
            "--root",
            type=Path,
            help="knowledge tree root (defaults to SHMIT_KNOWLEDGE_ROOT)",
        )

    investment = subcommands.add_parser("investment")
    investment.add_argument("document", type=Path)
    add_root(investment)
    investment.add_argument("--as-of")
    verify = subcommands.add_parser("verify")
    verify.add_argument("documents", nargs="+", type=Path)
    add_root(verify)
    verify.add_argument("--as-of")
    read = subcommands.add_parser("read")
    read.add_argument("documents", nargs="+", type=Path)
    add_root(read)
    connections = subcommands.add_parser("connections")
    connections.add_argument("document", type=Path)
    add_root(connections)
    confidence = subcommands.add_parser("confidence")
    confidence.add_argument("document", type=Path)
    add_root(confidence)
    confidence.add_argument("-a", "--all", action="store_true")
    search = subcommands.add_parser("search")
    add_root(search)
    search.add_argument("--tag", action="append", default=[])
    search.add_argument("--type", choices=("Concept", "Reference"))
    search.add_argument("--subtype")
    ontology = subcommands.add_parser("ontology")
    add_root(ontology)
    ontology.add_argument("report", choices=("terms", "facts", "requirements"))
    migrate = subcommands.add_parser("migrate")
    migrate.add_argument("--root", required=True, type=Path)
    migrate.add_argument("--apply", action="store_true")
    subcommands.add_parser("mcp")
    return result


def _migration(args, root: Path) -> int:
    plan = plan_migration(root)
    print(row(("kind", "source", "target")))
    for source, destination in plan.moves:
        print(row((
            "move",
            str(source.relative_to(root)),
            str(destination.relative_to(root)),
        )))
    for source, _, _ in plan.rewrites:
        print(row(("rewrite", str(source.relative_to(root)), "")))
    for role, count in plan.role_counts:
        print(row(("ontology", role, count)))
    for conflict in plan.conflicts:
        print(row(("conflict", conflict, "")))
    if args.apply:
        receipt = apply_migration(plan)
        for old, new in receipt:
            print(row(("applied", old, new)))
        print(row(("result", "applied", "")))
    return 1 if plan.conflicts else 0


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "mcp":
            from .mcp import serve

            return serve()
        if args.command == "migrate":
            return _migration(args, args.root.resolve())
        root = select_root(args.root)
        if args.command == "ontology":
            print(ontology_report(root, args.report), end="")
            return 0
        if args.command == "search":
            print(
                search_report(root, args.tag, args.type, args.subtype),
                end="",
            )
            return 0
        if args.command == "read":
            print(
                read_report(root, tuple(str(path) for path in args.documents)),
                end="",
            )
            return 0
        if args.command == "connections":
            print(connections_report(root, str(args.document)), end="")
            return 0
        if args.command == "confidence":
            print(
                confidence_report(root, str(args.document), args.all),
                end="",
            )
            return 0
        if args.command == "investment":
            print(
                investment_report(root, str(args.document), args.as_of),
                end="",
            )
            return 0
        report, valid = verification_reports(
            root, tuple(str(path) for path in args.documents), args.as_of
        )
        print(report, end="")
        return 0 if valid else 1
    except KnowledgeError as exc:
        print(f"knowledge-cli: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
