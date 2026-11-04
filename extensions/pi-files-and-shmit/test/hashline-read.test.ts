import { describe, expect, it } from "vitest";
import { createHashlineRead } from "../src/hashline-read";
import { InMemoryFilesystem, InMemorySnapshotStore, computeFileHash } from "@oh-my-pi/hashline";
import type { Theme } from "@earendil-works/pi-coding-agent";

const NOOP_CTX = { cwd: "" };

/** Pass-through theme stub: renders text with no ANSI styling so assertions
 * can match plain substrings. Only `fg`/`bold` are exercised by the
 * hashline_read renderers. */
const STUB_THEME = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as Theme;

/** Render a component's lines (join of `Text.render`). */
function renderLines(component: { render(width: number): string[] }): string {
	return component.render(120).join("\n");
}

describe("hashline_read", () => {
	it("emits a [path#TAG] header plus numbered lines", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "line1\nline2\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });

		const result = await read.execute("id", { path: "a.txt" }, undefined, undefined, NOOP_CTX);

		const text = (result.content[0] as { type: "text"; text: string }).text;
		const expectedTag = computeFileHash("line1\nline2\n");
		expect(text.startsWith(`[a.txt#${expectedTag}]`)).toBe(true);
		expect(text).toContain("1:line1");
		expect(text).toContain("2:line2");
	});

	it("returns an error result for a missing file", async () => {
		const fs = new InMemoryFilesystem();
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });

		// The tool throws so the Pi runtime flags the result as an error.
		await expect(read.execute("id", { path: "missing.txt" }, undefined, undefined, NOOP_CTX))
			.rejects.toThrow(/File not found/);
	});

	it("mints the same content tag for byte-identical content across different paths", async () => {
		const fs = new InMemoryFilesystem([
			["a.txt", "x\n"],
			["b.txt", "x\n"],
		]);
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });

		const a = await read.execute("id", { path: "a.txt" }, undefined, undefined, NOOP_CTX);
		const b = await read.execute("id", { path: "b.txt" }, undefined, undefined, NOOP_CTX);

		const tag = computeFileHash("x\n");
		expect((a.content[0] as { text: string }).text.startsWith(`[a.txt#${tag}]`)).toBe(true);
		expect((b.content[0] as { text: string }).text.startsWith(`[b.txt#${tag}]`)).toBe(true);
	});

	it("normalizes a UTF-8 BOM before hashing so the tag matches the patcher", async () => {
		const fs = new InMemoryFilesystem([["a.cs", "\uFEFFusing A;\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });

		const result = await read.execute("id", { path: "a.cs" }, undefined, undefined, NOOP_CTX);

		const text = (result.content[0] as { text: string }).text;
		// Patcher strips BOM then hashes; the read tool must mint the same tag.
		expect(text.startsWith(`[a.cs#${computeFileHash("using A;\n")}]`)).toBe(true);
	});
});

describe("hashline_read rendering (compact/expand)", () => {
	// `execute()` always returns the full body; the model sees it regardless of
	// TUI display state. The renderers control only what the human sees.
	async function readFixture() {
		const fs = new InMemoryFilesystem([["a.txt", "line1\nline2\nline3\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });
		const result = await read.execute("id", { path: "a.txt" }, undefined, undefined, NOOP_CTX);
		return { read, result };
	}

	it("renderCall: collapsed row shows the path + expand hint", async () => {
		const { read } = await readFixture();
		const comp = read.renderCall!(
			{ path: "a.txt" },
			STUB_THEME,
			{ args: { path: "a.txt" }, cwd: "", expanded: false, isError: false, lastComponent: undefined },
		);
		const out = renderLines(comp as { render(width: number): string[] });
		expect(out).toContain("hashline_read");
		expect(out).toContain("a.txt");
		expect(out).toContain("to expand");
	});

	it("renderCall: expanded row drops the expand hint", async () => {
		const { read } = await readFixture();
		const comp = read.renderCall!(
			{ path: "a.txt" },
			STUB_THEME,
			{ args: { path: "a.txt" }, cwd: "", expanded: true, isError: false, lastComponent: undefined },
		);
		const out = renderLines(comp as { render(width: number): string[] });
		expect(out).toContain("hashline_read");
		expect(out).toContain("a.txt");
		expect(out).not.toContain("to expand");
	});

	it("renderResult: collapsed non-error hides the body entirely", async () => {
		const { read, result } = await readFixture();
		const comp = read.renderResult!(
			result,
			{ expanded: false, isPartial: false },
			STUB_THEME,
			{ args: { path: "a.txt" }, cwd: "", expanded: false, isError: false, lastComponent: undefined },
		);
		// Empty setText -> Text.render returns [].
		expect((comp as { render(width: number): string[] }).render(120)).toEqual([]);
	});

	it("renderResult: expanded shows the [path#TAG] header + numbered body", async () => {
		const { read, result } = await readFixture();
		const comp = read.renderResult!(
			result,
			{ expanded: true, isPartial: false },
			STUB_THEME,
			{ args: { path: "a.txt" }, cwd: "", expanded: true, isError: false, lastComponent: undefined },
		);
		const out = renderLines(comp as { render(width: number): string[] });
		const tag = computeFileHash("line1\nline2\nline3\n");
		expect(out).toContain(`[a.txt#${tag}]`);
		expect(out).toContain("1:line1");
		expect(out).toContain("3:line3");
	});

	it("renderResult: error renders even when collapsed", () => {
		const fs = new InMemoryFilesystem();
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });
		// The Pi runtime builds an error result from the thrown message.
		const errorResult = { content: [{ type: "text", text: "File not found: a.txt" }] };
		const comp = read.renderResult!(
			errorResult,
			{ expanded: false, isPartial: false },
			STUB_THEME,
			{ args: { path: "a.txt" }, cwd: "", expanded: false, isError: true, lastComponent: undefined },
		);
		const out = renderLines(comp as { render(width: number): string[] });
		expect(out).toContain("File not found: a.txt");
	});
});
