# Call knowledge through MCP

Use the named MCP tools when the client exposes the `shmitty-knowledge` server. Use [Evaluate and verify knowledge](knowledge-cli.md) for shell operations and migration.

## Select the knowledge root

Set `root` on a call to select an explicit knowledge tree. Omit `root` only when `SHMIT_KNOWLEDGE_ROOT` selects the intended tree. An explicit `root` takes precedence. Each document path MAY be relative to the selected root or absolute within it. A directory resolves to its `index.md`.

## Select the tool

| Operation | Tool | Required input |
|---|---|---|
| Read documents with ancestor context | `knowledge_read` | Nonempty `documents` array |
| Find documents | `knowledge_search` | None |
| Follow authored and derived links | `knowledge_connections` | `document` |
| Evaluate evidence coverage | `knowledge_confidence` | `document` |
| Evaluate knowledge authority | `knowledge_investment` | `document` |
| Check document conformance | `knowledge_verify` | `document` |
| Inspect ontology terms, facts, or requirements | `knowledge_ontology` | `report` set to `terms`, `facts`, or `requirements` |

Pass `tags`, `type`, and `subtype` to narrow `knowledge_search`. Pass `all: true` to include recursive linked Concepts in `knowledge_confidence`. Pass `as_of` to select the evaluation time for `knowledge_investment` or `knowledge_verify`.

## Interpret the result

`knowledge_read` returns the complete Markdown report defined for `knowledge-cli read`. Its sanctioned execution YAML blocks provide the executable metadata and omit `reference_type`. Every other tool returns a complete TSV report. Preserve the column headings when passing a report to another operation or agent.

A completed `knowledge_verify` call is successful even when its TSV contains `result<TAB>invalid`; use its finding rows to revise the document. A tool result with `isError: true` means the operation could not run or complete. Correct the reported root, path, dependency, or knowledge error before retrying.

A cancelled call returns no result when cancellation wins. Inspect the tree again before retrying when another process could have changed it during the cancelled operation.
