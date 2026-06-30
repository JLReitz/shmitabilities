/**
 * The `lsp` tool.
 *
 * Two test surfaces:
 *  1. The stock-Pi `ToolDefinition` wrapper (`createLspTool`): param
 *     validation, the `file:"*"` rejection (workspace-diagnostics mode is
 *     dropped — the model has `bash`), the readonly-action gate, and
 *     delegation to `runLspAction`. Uses a stubbed `runAction` so no real
 *     language server is spawned.
 *  2. `runLspAction` directly: the cheap "no language server configured for
 *     this project / file" early-return branches, exercised against a real
 *     temp cwd with no language servers installed (so `getConfig(cwd)`
 *     resolves zero servers and no process is ever spawned). This is the
 *     YAGNI-aligned unit boundary: the position-based branches (hover,
 *     definition, …) are covered by the manual integration test
 *     against a real `typescript-language-server`; they are
 *     not duplicated here because stubbing the JSON-RPC client surface would
 *     just re-test the vendored functions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { createLspTool, type LspActionParams, type LspActionResult, type LspActionRunner } from "../src/lsp-tool";
import { runLspAction, LSP_READONLY_ACTIONS, LSP_WRITE_ACTIONS, LSP_ALL_ACTIONS } from "../src/vendor/lsp";

/** Build a stub `runAction` that records its call and returns a canned result. */
function makeStubRunAction(
	over: Partial<LspActionResult> = {},
): { runAction: LspActionRunner; calls: { params: LspActionParams; cwd: string }[] } {
	const calls: { params: LspActionParams; cwd: string }[] = [];
	const runAction: LspActionRunner = async (params, cwd) => {
		calls.push({ params, cwd });
		return {
			content: [{ type: "text", text: "stub-output" }],
			details: { action: params.action, success: true, request: params },
			...over,
		};
	};
	return { runAction, calls };
}

/** Resolve the `action` literal union from the tool's parameter schema. */
function actionLiterals(): string[] {
	const schema = createLspTool().parameters as any;
	const actionProp = schema.properties.action;
	// Type.Union of literals → { anyOf: [ { const: "status" }, ... ] }
	return actionProp.anyOf.map((t: { const: string }) => t.const);
}

describe("lsp tool — wrapper (createLspTool)", () => {
	it("declares all 14 actions (9 readonly + 5 write)", () => {
		const actions = actionLiterals().sort();
		expect(actions).toEqual(
			[
				"capabilities",
				"code_actions",
				"definition",
				"diagnostics",
				"hover",
				"implementation",
				"references",
				"reload",
				"rename",
				"rename_file",
				"request",
				"status",
				"symbols",
				"type_definition",
			].sort(),
		);
		expect(LSP_READONLY_ACTIONS.size).toBe(9);
	});

	it("has no `approval` field (stock pi ToolDefinition has no approval tier)", () => {
		const tool = createLspTool();
		expect((tool as any).approval).toBeUndefined();
	});

	it("delegates to runAction with the parsed params and ctx.cwd, and returns its content", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const ctx = { cwd: "/repo" };
		const result: any = await tool.execute(
			"id",
			{ action: "hover", file: "src/a.ts", line: 3, symbol: "foo" },
			undefined,
			undefined,
			ctx,
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			params: { action: "hover", file: "src/a.ts", line: 3, symbol: "foo" },
			cwd: "/repo",
		});
		expect(result.content[0].text).toBe("stub-output");
		expect(result.details).toEqual({
			action: "hover",
			success: true,
			request: { action: "hover", file: "src/a.ts", line: 3, symbol: "foo" },
		});
	});

	it("rejects file:'*' (workspace-diagnostics mode is dropped) without calling runAction", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "diagnostics", file: "*" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		expect(result.content[0].text).toMatch(/workspace-wide diagnostics/i);
		expect(result.details.success).toBe(false);
	});

	it("requires `file` for the position/symbol actions and short-circuits before runAction", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "definition", line: 5, symbol: "x" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		expect(result.content[0].text).toMatch(/file parameter required/i);
		expect(result.details.success).toBe(false);
	});

	it("requires `query` for workspace-symbols (file omitted) and short-circuits", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "symbols" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		// Upstream treats missing-query workspace symbols as an error.
		expect(result.details.success).toBe(false);
	});

	it("accepts every shipped action and forwards it to runAction", async () => {
		for (const action of actionLiterals()) {
			const { runAction, calls } = makeStubRunAction();
			const tool = createLspTool({ runAction });
			const params: LspActionParams = { action };
			// Actions that don't need a file: status, capabilities, reload, request.
			if (action !== "status" && action !== "capabilities" && action !== "reload" && action !== "request") {
				params.file = "src/a.ts";
			}
			if (action === "symbols") params.query = "Foo";
			if (action === "request") params.query = "textDocument/hover";
			await tool.execute("id", params, undefined, undefined, { cwd: "/repo" });
			expect(calls, `action=${action}`).toHaveLength(1);
			expect(calls[0].params.action).toBe(action);
		}
	});

	it("defaults to the real runLspAction when no seam is injected", async () => {
		// Sanity: the production wiring (no runAction) must reference the real
		// dispatcher, not throw at construction. A `status` call in a temp cwd
		// with no servers returns a clean "No language servers configured" line.
		const dir = await mkdtemp(join(tmpdir(), "lsp-tool-real-"));
		try {
			const tool = createLspTool();
			const result: any = await tool.execute("id", { action: "status" }, undefined, undefined, {
				cwd: dir,
			});
			expect(result.content[0].text).toMatch(/No language servers configured/i);
			expect(result.details.success).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("runLspAction — no-server early-return branches", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "lsp-run-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("status: reports no configured servers in a clean cwd", async () => {
		const r = await runLspAction({ action: "status" }, dir);
		expect(r.content[0].text).toMatch(/No language servers configured for this project/i);
		expect(r.details).toEqual({ action: "status", success: true, request: { action: "status" } });
	});

	it("diagnostics: rejects file:'*' (dropped workspace mode)", async () => {
		const r = await runLspAction({ action: "diagnostics", file: "*" }, dir);
		expect(r.content[0].text).toMatch(/workspace-wide diagnostics/i);
		expect(r.details.success).toBe(false);
	});

	it("diagnostics: requires `file`", async () => {
		const r = await runLspAction({ action: "diagnostics" }, dir);
		expect(r.content[0].text).toMatch(/file parameter required/i);
		expect(r.details.success).toBe(false);
	});

	it("diagnostics: a file with no matching server reports 'No language server found'", async () => {
		const file = join(dir, "a.unknownext");
		await writeFile(file, "x\n");
		const r = await runLspAction({ action: "diagnostics", file }, dir);
		expect(r.content[0].text).toMatch(/No language server found/i);
	});

	it("diagnostics: a glob matching no files reports 'No files matched'", async () => {
		const r = await runLspAction({ action: "diagnostics", file: "**/*.nosuchext" }, dir);
		expect(r.content[0].text).toMatch(/No files matched pattern/i);
	});

	it("symbols (workspace): requires `query`", async () => {
		const r = await runLspAction({ action: "symbols" }, dir);
		expect(r.content[0].text).toMatch(/query parameter required/i);
		expect(r.details.success).toBe(false);
	});

	it("symbols (workspace): no servers → 'No language server found for this action'", async () => {
		const r = await runLspAction({ action: "symbols", query: "Foo" }, dir);
		expect(r.content[0].text).toMatch(/No language server found for this action/i);
		expect(r.details.success).toBe(false);
	});

	it("position actions: a file with no server → 'No language server found for this action'", async () => {
		const file = join(dir, "a.unknownext");
		await writeFile(file, "x\n");
		const r = await runLspAction(
			{ action: "definition", file, line: 1, symbol: "x" },
			dir,
		);
		expect(r.content[0].text).toMatch(/No language server found for this action/i);
		expect(r.details.success).toBe(false);
	});

	it("position actions: require `file`", async () => {
		const r = await runLspAction({ action: "hover", line: 1, symbol: "x" }, dir);
		expect(r.content[0].text).toMatch(/file parameter required/i);
		expect(r.details.success).toBe(false);
	});

	it("capabilities: no servers configured → 'No language servers configured'", async () => {
		const r = await runLspAction({ action: "capabilities" }, dir);
		expect(r.content[0].text).toMatch(/No language servers configured/i);
		expect(r.details.success).toBe(false);
	});
});

describe("lsp tool — write-action wrapper validation", () => {
	it("LSP_WRITE_ACTIONS has exactly the 5 write actions", () => {
		expect([...LSP_WRITE_ACTIONS].sort()).toEqual(
			["code_actions", "reload", "rename", "rename_file", "request"].sort(),
		);
	});

	it("LSP_ALL_ACTIONS is the union of readonly + write", () => {
		expect(LSP_ALL_ACTIONS.size).toBe(14);
		for (const a of LSP_READONLY_ACTIONS) expect(LSP_ALL_ACTIONS.has(a)).toBe(true);
		for (const a of LSP_WRITE_ACTIONS) expect(LSP_ALL_ACTIONS.has(a)).toBe(true);
	});

	it("rename_file without file short-circuits (needs file)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "rename_file", new_name: "b.ts" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		expect(result.content[0].text).toMatch(/file parameter required/i);
		expect(result.details.success).toBe(false);
	});

	it("rename without file short-circuits (needs file)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "rename", new_name: "bar", line: 1, symbol: "foo" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		expect(result.content[0].text).toMatch(/file parameter required/i);
		expect(result.details.success).toBe(false);
	});

	it("code_actions without file short-circuits (needs file)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "code_actions" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		expect(result.details.success).toBe(false);
	});

	it("reload without file is allowed through (workspace scope)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		await tool.execute("id", { action: "reload" }, undefined, undefined, { cwd: "/repo" });
		expect(calls).toHaveLength(1);
		expect(calls[0].params.action).toBe("reload");
	});

	it("reload with file:'*' is allowed through (workspace scope)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		await tool.execute("id", { action: "reload", file: "*" }, undefined, undefined, { cwd: "/repo" });
		expect(calls).toHaveLength(1);
		expect(calls[0].params.action).toBe("reload");
	});

	it("request without file is allowed through (workspace-level)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		await tool.execute(
			"id",
			{ action: "request", query: "workspace/symbol" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].params.action).toBe("request");
	});

	it("write actions forward new_name/apply/payload to runAction", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		await tool.execute(
			"id",
			{ action: "rename", file: "a.ts", line: 3, symbol: "foo", new_name: "bar", apply: false },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].params).toEqual({
			action: "rename",
			file: "a.ts",
			line: 3,
			symbol: "foo",
			new_name: "bar",
			apply: false,
		});
	});

	it("rejects an unknown action (defense in depth)", async () => {
		const { runAction, calls } = makeStubRunAction();
		const tool = createLspTool({ runAction });
		const result: any = await tool.execute(
			"id",
			{ action: "DELETE_TABLE" },
			undefined,
			undefined,
			{ cwd: "/repo" },
		);
		expect(calls).toHaveLength(0);
		expect(result.details.success).toBe(false);
		expect(result.content[0].text).toMatch(/unknown action/i);
	});
});

describe("runLspAction — write-action no-server early-return branches", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "lsp-write-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("rename_file: requires both file and new_name", async () => {
		const r = await runLspAction({ action: "rename_file", file: "a.ts" }, dir);
		expect(r.content[0].text).toMatch(/requires both `file`.*`new_name`/i);
		expect(r.details.success).toBe(false);
	});

	it("rename_file: source path must exist", async () => {
		const r = await runLspAction(
			{ action: "rename_file", file: "nonexistent.ts", new_name: "other.ts" },
			dir,
		);
		expect(r.content[0].text).toMatch(/source path does not exist/i);
		expect(r.details.success).toBe(false);
	});

	it("rename_file: rejects identical source/dest", async () => {
		const file = join(dir, "a.ts");
		await writeFile(file, "x\n");
		const r = await runLspAction(
			{ action: "rename_file", file, new_name: file },
			dir,
		);
		expect(r.content[0].text).toMatch(/source and destination paths are identical/i);
		expect(r.details.success).toBe(false);
	});

	it("rename_file: rejects source path escaping cwd via ../", async () => {
		const src = join(dir, "a.ts");
		await writeFile(src, "x\n");
		const r = await runLspAction(
			{ action: "rename_file", file: "../a.ts", new_name: "b.ts" },
			dir,
		);
		expect(r.content[0].text).toMatch(/must stay within the workspace/i);
		expect(r.details.success).toBe(false);
	});

	it("rename_file: rejects destination path escaping cwd via ../../", async () => {
		const src = join(dir, "a.ts");
		await writeFile(src, "x\n");
		const r = await runLspAction(
			{ action: "rename_file", file: "a.ts", new_name: "../../evil.txt" },
			dir,
		);
		expect(r.content[0].text).toMatch(/must stay within the workspace/i);
		expect(r.details.success).toBe(false);
	});

	it("rename_file: rejects absolute source path outside cwd", async () => {
		const outside = join(tmpdir(), "outside-lsp-test.ts");
		await writeFile(outside, "x\n");
		try {
			const r = await runLspAction(
				{ action: "rename_file", file: outside, new_name: "b.ts" },
				dir,
			);
			expect(r.content[0].text).toMatch(/must stay within the workspace/i);
			expect(r.details.success).toBe(false);
		} finally {
			await rm(outside, { force: true });
		}
	});

	it("rename_file: rejects existing destination", async () => {
		const src = join(dir, "a.ts");
		const dest = join(dir, "b.ts");
		await writeFile(src, "x\n");
		await writeFile(dest, "y\n");
		const r = await runLspAction(
			{ action: "rename_file", file: src, new_name: dest },
			dir,
		);
		expect(r.content[0].text).toMatch(/destination already exists/i);
		expect(r.details.success).toBe(false);
	});

	it("rename_file: apply:false previews without mutating disk (no servers → 'No LSP edits')", async () => {
		const src = join(dir, "a.ts");
		await writeFile(src, "x\n");
		const r = await runLspAction(
			{ action: "rename_file", file: src, new_name: "b.ts", apply: false },
			dir,
		);
		expect(r.details.success).toBe(true);
		expect(r.content[0].text).toMatch(/Rename preview/i);
		expect(r.content[0].text).toMatch(/No LSP edits would be applied/i);
		// Source must still exist (no disk mutation in preview mode).
		const { access } = await import("node:fs/promises");
		await expect(access(src)).resolves.toBeUndefined();
	});

	it("request: requires query (method name)", async () => {
		const r = await runLspAction({ action: "request" }, dir);
		expect(r.content[0].text).toMatch(/requires `query` to specify the LSP method name/i);
		expect(r.details.success).toBe(false);
	});

	it("request: with file but no server → 'No language server found for this file'", async () => {
		const file = join(dir, "a.unknownext");
		await writeFile(file, "x\n");
		const r = await runLspAction(
			{ action: "request", file, query: "textDocument/hover" },
			dir,
		);
		expect(r.content[0].text).toMatch(/No language server found for this file/i);
		expect(r.details.success).toBe(false);
	});

	it("request: workspace-level with no servers → 'No language servers configured'", async () => {
		const r = await runLspAction(
			{ action: "request", query: "workspace/symbol" },
			dir,
		);
		expect(r.content[0].text).toMatch(/No language servers configured/i);
		expect(r.details.success).toBe(false);
	});

	it("request: rejects invalid JSON payload", async () => {
		// Needs a server to get past the no-server guard; but the payload parse
		// happens after server resolution, so with no server + file we get the
		// 'No language server found' first. Test payload parsing via workspace:
		// no servers → 'No language servers configured' (the payload is never
		// reached). This test documents that ordering: server resolution precedes
		// payload parsing, matching upstream.
		const r = await runLspAction(
			{ action: "request", query: "x", payload: "{invalid" },
			dir,
		);
		expect(r.content[0].text).toMatch(/No language servers configured/i);
		expect(r.details.success).toBe(false);
	});

	it("reload: workspace with no servers → 'No language server found for this action'", async () => {
		const r = await runLspAction({ action: "reload" }, dir);
		expect(r.content[0].text).toMatch(/No language server found for this action/i);
		expect(r.details.success).toBe(false);
	});

	it("reload: workspace (file:'*') with no servers → 'No language server found for this action'", async () => {
		const r = await runLspAction({ action: "reload", file: "*" }, dir);
		expect(r.content[0].text).toMatch(/No language server found for this action/i);
		expect(r.details.success).toBe(false);
	});

	it("rename: with a file but no server → 'No language server found for this action'", async () => {
		const file = join(dir, "a.unknownext");
		await writeFile(file, "x\n");
		const r = await runLspAction(
			{ action: "rename", file, line: 1, symbol: "x", new_name: "y" },
			dir,
		);
		expect(r.content[0].text).toMatch(/No language server found for this action/i);
		expect(r.details.success).toBe(false);
	});

	it("code_actions: with a file but no server → 'No language server found for this action'", async () => {
		const file = join(dir, "a.unknownext");
		await writeFile(file, "x\n");
		const r = await runLspAction(
			{ action: "code_actions", file, line: 1 },
			dir,
		);
		expect(r.content[0].text).toMatch(/No language server found for this action/i);
		expect(r.details.success).toBe(false);
	});
});
