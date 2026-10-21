import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .confidence import evaluate_confidence, render_confidence
from .connections import collect_connections, render_connections
from .document import load_document
from .errors import KnowledgeError
from .investment import as_datetime, evaluate, load_policy
from .ontology import build_snapshot
from .paths import resolve_document_path
from .reading import expand_read, render_read
from .search import matching_documents, render_search
from .validation import verify
from .tsv import row


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="knowledge-cli")
    subcommands = result.add_subparsers(dest="command", required=True)

    def add_root(command):
        command.add_argument(
            "--root",
            type=Path,
            default=os.environ.get("SHMIT_KNOWLEDGE_ROOT"),
            help="knowledge tree root (defaults to SHMIT_KNOWLEDGE_ROOT)",
        )

    for name in ("investment", "verify"):
        command = subcommands.add_parser(name)
        command.add_argument("document", type=Path)
        add_root(command)
        command.add_argument("--as-of")
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
    return result


def evaluation_time(raw: str) -> datetime:
    return as_datetime(raw, "--as-of") if raw else datetime.now(timezone.utc)


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.root is None:
            raise KnowledgeError(
                "--root is required when SHMIT_KNOWLEDGE_ROOT is unset"
            )
        root = args.root.resolve()
        if args.command == "ontology":
            if not root.is_dir():
                raise KnowledgeError(
                    f"{root}: knowledge tree root is not a directory"
                )
            snapshot = build_snapshot(root)
            if args.report == "terms":
                print(row(("concept", "tag", "term", "kind", "match")))
                for item in sorted(snapshot.terms, key=lambda item: (
                    str(item.concept), item.tag, item.term, item.kind
                )):
                    print(row((
                        "/" + item.concept.resolve().relative_to(
                            root
                        ).as_posix(),
                        item.tag, item.term, item.kind, item.match,
                    )))
            elif args.report == "facts":
                print(row((
                    "subject", "predicate", "object", "source", "link"
                )))
                for item in sorted(snapshot.facts, key=lambda item: (
                    item.subject, item.predicate, item.object
                )):
                    print(row((
                        item.subject, item.predicate, item.object,
                        "inferred" if item.derived else "asserted", item.link,
                    )))
            else:
                print(row((
                    "concept", "class", "property", "filler",
                    "direction", "link"
                )))
                for item in sorted(snapshot.requirements, key=lambda item: (
                    str(item.concept), item.source_class, item.property,
                    item.target_class
                )):
                    concept = "/" + item.concept.resolve().relative_to(
                        root
                    ).as_posix()
                    links = item.links or (None,)
                    for link in links:
                        print(row((
                            concept, item.source_class, item.property,
                            item.target_class, "outbound",
                            "/" + link.resolve().relative_to(root).as_posix()
                            if link is not None else "",
                        )))
            return 0
        if args.command == "search":
            if not root.is_dir():
                raise KnowledgeError(
                    f"{root}: knowledge tree root is not a directory"
                )
            print(render_search(
                root,
                matching_documents(root, args.tag, args.type, args.subtype),
            ), end="")
            return 0
        if args.command == "read":
            print(render_read(root, expand_read(root, args.documents)), end="")
            return 0
        path = resolve_document_path(root, args.document)
        document = load_document(path)
        if args.command == "connections":
            print(
                render_connections(
                    root, document, collect_connections(root, document)
                ),
                end="",
            )
            return 0
        if args.command == "confidence":
            evaluation = evaluate_confidence(root, document)
            print(
                render_confidence(root, document, evaluation, args.all), end=""
            )
            return 0
        as_of = evaluation_time(args.as_of)
        if args.command == "investment":
            score = evaluate(root, document, as_of)
            print(row(("field", "value")))
            print(row(("concept", document.path)))
            print(row(("evaluated", as_of.isoformat())))
            print(row(("confidence", f"{score.confidence:.6f}")))
            print(row(("consistency", f"{score.consistency:.6f}")))
            if score.connection is not None:
                print(row(("fulfilled", score.fulfilled)))
                print(row(("open", score.open)))
                print(row(("qualifying_links", score.qualifying_links)))
                print(row(("target", load_policy(root).connection_target)))
                print(row(("connection", f"{score.connection:.6f}")))
            print(row(("investment", f"{score.total:.6f}")))
            return 0
        findings = verify(root, document, as_of)
        print(row(("field", "value")))
        print(row(("document", document.path)))
        print(row(("evaluated", as_of.isoformat())))
        if not findings:
            print(row(("result", "valid")))
            return 0
        print(row(("result", "invalid")))
        for finding in findings:
            print(row((finding.field, finding.message)))
        return 1
    except KnowledgeError as exc:
        print(f"knowledge-cli: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
