/**
 * `lsp` tool.
 *
 * A stock-Pi `ToolDefinition` over the vendored LSP functions in
 * `./vendor/lsp` (`runLspAction`). Ships all 14 actions from upstream's
 * `lspSchema`: the 9 read-only actions (`status`, `capabilities`,
 * `diagnostics`, `hover`, `definition`, `type_definition`, `implementation`,
 * `references`, `symbols`) plus the 5 write-tier actions
 * `rename`, `rename_file` (full cross-server fan-out),
 * `code_actions` (with `apply` + `executeCommand`), `reload`, and raw
 * `request`.
 *
 * Scope trims: the `diagnostics` `file:"*"` workspace shell-out
 * mode is dropped (the model has `bash` for project builds); workspace
 * `symbols` is kept (bounded by a 200-result cap).
 *
 * The single `lsp` tool ships all 14 actions (9 read-only + 5 write-tier)
 * in one tool. Stock pi has no per-tool approval tier —
 * the `ToolDefinition` interface has no `approval` field — so read-only and
 * write-tier actions are indistinguishable to the harness. Write-tier safety
 * is enforced inside `runLspAction`: writes are gated on `apply` and the
 * action; `apply:false` returns a preview before any write. The wrapper
 * validates the action is in `LSP_ALL_ACTIONS` and rejects `file:"*"` for
 * diagnostics before delegating to `runLspAction`, so the dropped mode can
 * never reach the vendored dispatcher even if a future caller bypasses the
 * parameter schema.
 *
 * Injection seam: `createLspTool({ runAction })` lets tests stub the dispatcher
 * without spawning a language server. The production wiring in `index.ts`
 * omits the seam so the real `runLspAction` is used.
 */
import { Type } from "@sinclair/typebox";
import {
	LSP_ALL_ACTIONS,
	runLspAction,
	type LspActionParams,
	type LspActionResult,
} from "./vendor/lsp";

/** Dispatcher signature: the wrapper delegates all real work here. */
export type LspActionRunner = (
	params: LspActionParams,
	cwd: string,
	signal?: AbortSignal,
) => Promise<LspActionResult>;

export type { LspActionParams, LspActionResult } from "./vendor/lsp";

export interface LspToolDeps {
	/** Override the action dispatcher (tests). Defaults to the real
	 * `runLspAction`. */
	runAction?: LspActionRunner;
}

export function createLspTool(deps: LspToolDeps = {}) {
	const runAction = deps.runAction ?? runLspAction;
	return {
		name: "lsp",
		label: "LSP",
		promptSnippet:
			"Query/drive a language server: diagnostics, hover, definitions, references, symbols, rename",
		promptGuidelines: [
			"`lsp` requires a configured server for the file's language (TS/JS, Bash, Python, Rust, Go, C/C++); check `action:\"status\"` first if unsure. No server → actions return a clean no-server result, not an error.",
			"Project-aware servers (rust-analyzer, gopls, pyright) need `symbol` for position-based actions (hover/definition/references/rename) to resolve the right column; TS/bash/clangd resolve from `line` alone.",
			"Workspace-wide `diagnostics` (`file:\"*\"`) is not supported — use `bash` to run a project build (`tsc`/`cargo`/`go build`/`pyright`).",
			"Write actions (`rename`, `rename_file`, `code_actions` with `apply:true`) mutate the workspace; pass `apply:false` to preview the LSP edits first.",
		],
		description:
			"Query or drive a language server (LSP): read-only intelligence " +
			"(diagnostics, hover/type info, definition/type-definition/" +
			"implementation/references lookups, document/workspace symbols, " +
			"server status + capabilities) and write-tier operations (rename " +
			"symbol, rename file with cross-server edit fan-out, apply code " +
			"actions, reload server config, raw LSP request). Languages are " +
			"limited to the native ast crate's grammars that ship an LSP server " +
			"(TypeScript/JS, Bash, Python, Rust, Go, C/C++); configure " +
			"additional servers in `.pi/shmit.json` under the `lsp` key.\n\n" +
			"Actions: `status`, `capabilities`, `diagnostics` (per-file/glob; " +
			"workspace-wide `file:\"*\"` is NOT supported — use `bash` for project " +
			"builds), `hover`, `definition`, `type_definition`, `implementation`, " +
			"`references`, `symbols` (document symbols with `file`, or workspace " +
			"symbols with `query`), `rename` (needs `new_name`; `apply:false` " +
			"previews), `rename_file` (needs `file` + `new_name`; `apply:false` " +
			"previews the LSP edits without moving), `code_actions` (list with " +
			"`file`; `apply:true` + `query` selects by title substring or index), " +
			"`reload` (`*` or no file = workspace config re-read + all servers), " +
			"`request` (`query` = method name; `payload` = raw JSON params). " +
			"Project-aware servers (rust-analyzer, gopls, pyright) require " +
			"`symbol` for position-based actions.",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("status"),
					Type.Literal("capabilities"),
					Type.Literal("diagnostics"),
					Type.Literal("hover"),
					Type.Literal("definition"),
					Type.Literal("type_definition"),
					Type.Literal("implementation"),
					Type.Literal("references"),
					Type.Literal("symbols"),
					Type.Literal("rename"),
					Type.Literal("rename_file"),
					Type.Literal("code_actions"),
					Type.Literal("reload"),
					Type.Literal("request"),
				],
				{ description: "LSP action to run. Read-only: status, capabilities, diagnostics, hover, definition, type_definition, implementation, references, symbols. Write-tier (4c): rename, rename_file, code_actions, reload, request." },
			),
			file: Type.Optional(
				Type.String({
					description:
						"Target file path (absolute or relative to cwd). Required for " +
						"position/symbol actions. For `symbols`, omit `file` (or use `*`) " +
						"with `query` for workspace symbol search. `file:\"*\"` is valid " +
						"for `symbols` (workspace scope) and `reload` (workspace config " +
						"re-read); it is rejected for `diagnostics` (use `bash` for " +
						"project-wide builds).",
				}),
			),
			line: Type.Optional(
				Type.Number({
					description:
						"1-based line number for position-based actions (hover, definition, " +
						"type_definition, implementation, references, rename, code_actions).",
				}),
			),
			symbol: Type.Optional(
				Type.String({
					description:
						"Symbol name to resolve the character column (e.g. `foo`, or " +
						"`foo#2` for the 2nd occurrence on the line). Required for " +
						"`definition`/`references`/`rename` on project-aware servers " +
						"(rust-analyzer, gopls, pyright) to avoid pointing at the wrong " +
						"identifier.",
				}),
			),
			query: Type.Optional(
				Type.String({
					description:
						"Workspace symbol search query (for `action:\"symbols\"` without a " +
						"`file`). Capped at 200 results. For `action:\"request\"`, this is " +
						"the LSP method name (e.g. 'rust-analyzer/expandMacro'). For " +
						"`action:\"code_actions\"` with `apply:true`, this is the action " +
						"selector (title substring or 0-based index).",
				}),
			),
			new_name: Type.Optional(
				Type.String({
					description:
						"New name for `rename` (symbol rename at a position) and " +
						"`rename_file` (destination path). Required for both actions.",
				}),
			),
			apply: Type.Optional(
				Type.Boolean({
					description:
						"Whether to apply (vs preview) for `rename`, `rename_file`, and " +
						"`code_actions`. Default: apply (matching upstream `apply !== false`). " +
						"Pass `false` to preview the LSP edits without writing. Pass `true` " +
						"with `query` for `code_actions` to apply a selected action.",
				}),
			),
			payload: Type.Optional(
				Type.String({
					description:
						"Raw JSON payload for `action:\"request\"`. When set, overrides the " +
						"default `{ textDocument, position }` params and is sent verbatim.",
				}),
			),
			timeout: Type.Optional(
				Type.Number({
					description:
						"Wall-clock budget in seconds (default 30, max 600). The server may " +
						"still be indexing on cold starts; raise this if a lookup times out.",
				}),
			),
		}),

		async execute(
			_toolCallId: string,
			params: LspActionParams,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd: string },
		): Promise<LspActionResult> {
			const action = typeof params.action === "string" ? params.action : "";

			// Defense in depth: the schema already constrains `action` to the 14
			// literals, but reject anything else before touching the dispatcher.
			if (!LSP_ALL_ACTIONS.has(action)) {
				return {
					content: [
						{
							type: "text",
							text: `Error: unknown action "${action}". Supported: ${[...LSP_ALL_ACTIONS].join(", ")}.`,
						},
					],
					details: { action, success: false, request: params },
				};
			}

			// The workspace-diagnostics `file:"*"` mode shells out to a build
			// tool and is intentionally not shipped. Reject it at
			// the wrapper so it can never reach `runLspAction`'s diagnostics
			// branch. `file:"*"` remains valid for `symbols` (workspace scope)
			// and `reload` (workspace config re-read).
			if (action === "diagnostics" && params.file === "*") {
				return {
					content: [
						{
							type: "text",
							text: 'Error: workspace-wide diagnostics (file="*") is not supported. Use `bash` to run a project build (tsc/cargo/go build/pyright) or pass a path/glob for specific files.',
						},
					],
					details: { action, success: false, request: params },
				};
			}

			// Mirror upstream's `requiresFile` guard for the position/symbol
			// actions that need a concrete file. `status`, `capabilities`,
			// `reload` (workspace), and `request` (workspace-level) are allowed
			// without a file. Workspace `symbols` (no file, with query) is allowed
			// through. Everything else (diagnostics, hover, definition,
			// type_definition, implementation, references, rename, rename_file,
			// code_actions) requires a file.
			const needsFile =
				action !== "status" &&
				action !== "capabilities" &&
				action !== "reload" &&
				action !== "request" &&
				!(action === "symbols" && params.query !== undefined && (!params.file || params.file === "*"));
			if (needsFile && !params.file) {
				return {
					content: [
						{
							type: "text",
							text: "Error: file parameter required. Use `*` for workspace symbol scope (with `query`), workspace reload, or omit for workspace-level request.",
						},
					],
					details: { action, success: false, request: params },
				};
			}

			return runAction(params, ctx.cwd, signal);
		},
	};
}
