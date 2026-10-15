# Sanctioned executions

A sanctioned execution is a `Reference` with `reference_type: Command` or `reference_type: Computation`. Its definition specifies how to reproduce evidence from a persistent resource and attest the receipt.

Set its `resource` to a persistent source documented by an ordinary source Reference with the same normalized URL. Place a package-scoped Command or Computation under `references/packages/<package>/`. Place other sanctioned executions under the source domain.

## Reference body

Every sanctioned execution body MUST describe its arguments, receipt, and behavior in enough detail to run and interpret it without web access. It MAY use prose, lists, tables, headings, or a combination of these forms.

- Arguments MUST map each declared argument to its value template, accepted values or constraints, quoting rules where they matter, default behavior, and effect on the execution. State that the execution accepts no arguments when `args` is absent or empty.
- The receipt description MUST map each declared receipt field to its value template, data shape, producer, collection point, and presence on success and error paths.
- The behavior description MUST state the success effects, success status, and accepted attester verdict. It MUST state each known error path, partial effects, status or diagnostic, and failure meaning. It MUST distinguish command failure from attester failure.

Keep receipts, verdicts, and execution logs out of the Reference body. Define their reusable templates and meanings there.

The following Command uses headings and tables as one conforming layout.

## Commands

Use `Command` for one command or subcommand pattern. Set `resource` to the documentation for that command; the package documentation can serve as the resource when it describes the command.

```markdown
---
type: Reference
reference_type: Command
title: Revenue for fiscal year
description: Reproduces recognized revenue for one fiscal year.
tags: [references, packages, bigquery, revenue]
timestamp: 2026-09-20T12:00:00-07:00
resource: https://cloud.google.com/bigquery/docs/bq-command-line-tool
resource_type: Webpage
runtime: bash
command: run-bigquery --year "${year}"
args:
  - { name: year, type: integer, required: true }
receipt: [job_id, executed_sql, result]
attester:
  command: check-query --receipt "${receipt_file}"
  args:
    - { name: receipt_file, type: path, required: true }
---

## Arguments

| Argument | Value template | Meaning |
|---|---|---|
| `year` | Four-digit integer | Fiscal year passed as one shell-quoted value to `--year`. |

## Receipt

| Field | Value template | Meaning |
|---|---|---|
| `job_id` | Non-empty string | Warehouse job identifier emitted after query submission. |
| `executed_sql` | UTF-8 string | Exact SQL accepted by the warehouse. |
| `result` | JSON array | Recognized-revenue rows returned after successful completion. |

## Behavior

| Path | Behavior | Meaning |
|---|---|---|
| Success | Exit status `0`; all receipt fields are present; `check-query` accepts the receipt. | The warehouse completed the query and the receipt matches the request. |
| Invalid year | Exit status `2`; the command does not submit a job. | `year` is outside the command's accepted fiscal-year range. |
| Query error | Nonzero exit status with a warehouse diagnostic; `job_id` can be present. | The warehouse rejected or failed the submitted query. |
| Attester error | Command exit status `0`; `check-query` rejects the receipt. | The result or receipt does not satisfy the sanctioned checks. |
```

Each `Command` requires non-empty `runtime` and `command` strings, a `receipt` list, and a non-empty `attester.command` string. `args` declares typed named inputs. `attester.args` declares the attester's typed inputs.

## Computations

Use `Computation` for a batch of commands or processes with a managed virtual environment. A Computation requires at least two `commands` entries, a `receipt` list, and a non-empty `attester.command` string. Each command entry requires non-empty `runtime` and `command` strings. Each entry defines one component; list position does not define execution order. Declare arguments that allow the intended permutations.

```yaml
---
type: Reference
reference_type: Computation
title: Revenue for fiscal year
description: Reproduces recognized revenue for one fiscal year.
tags: [references, finance, revenue]
timestamp: 2026-09-20T12:00:00-07:00
resource: https://warehouse.example.com/finance/revenue
resource_type: Database
commands:
  - runtime: bigquery
    command: run-bigquery
    args:
      - { name: year, type: integer, required: true }
  - runtime: python
    command: summarize-revenue
    args:
      - { name: data, type: path, required: true }
receipt: [job_id, executed_sql, result]
attester:
  command: check-query
  args:
    - { name: data, type: path, required: true }
---
```

Record the managed virtual environment and dependencies in the computation body. State command order, parallelism, synchronization, input and output bindings, receipt collection, and the attester's checks there.

## Attestation

1. Load the sanctioned reference and supply values for its declared arguments.
2. Run the command or computation as defined and collect every declared receipt field.
3. Pass the receipt to the attester and report its verdict with the result.

Receipts, verdicts, execution logs, and computed results are ephemeral evidence. Reproduce them from the sanctioned reference when needed.
