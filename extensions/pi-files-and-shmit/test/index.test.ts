/**
 * Smoke test for the extension entry: loads the real default factory and runs
 * it against a stub `ExtensionAPI`, validating the full wiring (shared
 * NodeFilesystem + InMemorySnapshotStore → createHashlineRead +
 * createHashlineEdit → registerTool) registers both tools without throwing.
 *
 * This mirrors what Pi's loader does at `/reload` time, minus the virtual-
 * module aliasing (which only affects the type-only `ExtensionAPI` import).
 */
import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import factory from "../index";

interface RegisteredTool {
	name: string;
	label: string;
	parameters: object;
	execute: (...args: unknown[]) => unknown;
}

function createStubApi(): { api: any; tools: RegisteredTool[] } {
	const tools: RegisteredTool[] = [];
	const api = {
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
	};
	return { api, tools };
}

describe("extension entry (index.ts)", () => {
	it("registers hashline_read and hashline_edit without throwing", () => {
		const { api, tools } = createStubApi();

		expect(() => factory(api)).not.toThrow();

		expect(tools).toHaveLength(5);
		expect(tools.map((t) => t.name).sort()).toEqual([
			"ast_edit",
			"ast_grep",
			"hashline_edit",
			"hashline_read",
			"lsp",
		]);
		for (const tool of tools) {
			expect(tool.label).toBeTruthy();
			expect(tool.parameters).toBeInstanceOf(Object);
			expect(typeof tool.execute).toBe("function");
		}
	});

	it("wires both tools over a shared snapshot store so a read-minted tag validates at edit time", async () => {
		const { api, tools } = createStubApi();
		factory(api);
		const read = tools.find((t) => t.name === "hashline_read")!;
		const edit = tools.find((t) => t.name === "hashline_edit")!;

		// The shared store means a tag minted by read must be accepted by edit.
		// Use a real temp file so NodeFilesystem actually reads/writes disk.
		const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = await mkdtemp(join(tmpdir(), "hashline-smoke-"));
		try {
			const file = join(dir, "a.txt");
			await writeFile(file, "hello\n");

			const ctx = { cwd: dir };
			const readResult: any = await read.execute("id", { path: file }, undefined, undefined, ctx);
			const header = readResult.content[0].text.split("\n")[0];

			const editResult: any = await edit.execute(
				"id",
				{ input: `${header}\nSWAP 1.=1:\n+world` },
				undefined,
				undefined,
				ctx,
			);
			expect(editResult.isError).toBeFalsy();
			expect(editResult.content[0].text).toContain("update");

			const { readFile } = await import("node:fs/promises");
			expect(await readFile(file, "utf-8")).toBe("world\n");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
