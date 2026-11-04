import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHashlineEdit } from "../src/hashline-edit";
import { createHashlineRead } from "../src/hashline-read";
import {
	InMemoryFilesystem,
	InMemorySnapshotStore,
	Patch,
	computeFileHash,
} from "@oh-my-pi/hashline";
import type { WritethroughCallback, FileDiagnosticsResult } from "../src/vendor/lsp";

const NOOP_CTX = { cwd: "" };

async function runEdit(
	edit: ReturnType<typeof createHashlineEdit>,
	input: string,
	dryRun = false,
): Promise<{ isError?: boolean; text: string }> {
	// The Pi runtime flags errors only when execute() throws, so the tool throws
	// on mismatch/partial-failure. This helper maps thrown errors back to the
	// { isError, text } shape the assertions use. `dryRun = true` routes through
	// the side-effect-free preview path.
	try {
		const result = await edit.execute("id", { input, dryRun }, undefined, undefined, NOOP_CTX);
		return { text: (result.content[0] as { type: "text"; text: string }).text };
	} catch (err) {
		return { isError: true, text: (err as Error).message };
	}
}

describe("hashline_edit", () => {
	it("parses a simple SWAP op", () => {
		const patch = Patch.parse("[test.txt#ABCD]\nSWAP 1.=1:\n+replacement");
		expect(patch.sections).toHaveLength(1);
		expect(patch.sections[0]?.path).toBe("test.txt");
		expect(patch.sections[0]?.fileHash).toBe("ABCD");
	});

	it("parses a SWAP +N op (N lines from start)", () => {
		const patch = Patch.parse("[test.txt#ABCD]\nSWAP 5.+3:\n+line1\n+line2\n+line3");
		expect(patch.sections).toHaveLength(1);
		// +3 from line 5 → range 5 through 7
		const range = patch.sections[0]?.edits?.find(e => e.kind === "delete")?.anchor;
		// verify the deletion anchor starts at line 5 and 3 deletions were emitted
		const deletes = patch.sections[0]?.edits?.filter(e => e.kind === "delete") ?? [];
		expect(deletes).toHaveLength(3);
		expect(deletes[0]?.anchor.line).toBe(5);
		expect(deletes[1]?.anchor.line).toBe(6);
		expect(deletes[2]?.anchor.line).toBe(7);
	});

	it("applies a SWAP +N op to replace multiple lines (in-memory)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "one\ntwo\nthree\nfour\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tag = computeFileHash("one\ntwo\nthree\nfour\n");
		// SWAP 2.+3: replaces lines 2-4 (three lines starting at line 2)
		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 2.+3:\n+B\n+C\n+D`);
		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("one\nB\nC\nD\n");
	});

	it("applies a SWAP op minted via hashline_read (in-memory)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const read = createHashlineRead({ fs, snapshots });
		const edit = createHashlineEdit({ fs, snapshots });

		const readResult = await read.execute("id", { path: "a.txt" }, undefined, undefined, NOOP_CTX);
		const header = (readResult.content[0] as { text: string }).text.split("\n")[0];
		const result = await runEdit(edit, `${header}\nSWAP 1.=1:\n+after`);

		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("after\n");
		// Result echoes a fresh [path#TAG] header for the post-edit content.
		expect(result.text).toContain("[a.txt#");
		expect(result.text).toContain("update");
	});

	it("applies edits to two files in a single patch (in-memory)", async () => {
		const fs = new InMemoryFilesystem([
			["a.txt", "A\n"],
			["b.txt", "B\n"],
		]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tagA = computeFileHash("A\n");
		const tagB = computeFileHash("B\n");
		const input = `[a.txt#${tagA}]\nSWAP 1.=1:\n+A2\n[b.txt#${tagB}]\nSWAP 1.=1:\n+B2`;

		const result = await runEdit(edit, input);

		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("A2\n");
		expect(fs.get("b.txt")).toBe("B2\n");
	});

	it("rejects a fabricated tag with MismatchError and leaves the file untouched", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "current\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const live = computeFileHash("current\n");
		const bogus = live === "FFFF" ? "0000" : "FFFF";

		const result = await runEdit(edit, `[a.txt#${bogus}]\nSWAP 1.=1:\n+after`);

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/not from this session/);
		// Refusal must never leave a partial write.
		expect(fs.get("a.txt")).toBe("current\n");
	});

	it("reports a noop (no error) when an edit leaves the content identical", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tag = computeFileHash("before\n");

		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+before`);

		expect(result.isError).toBeFalsy();
		expect(result.text).toMatch(/noop/);
		expect(fs.get("a.txt")).toBe("before\n");
	});

	describe("partial commit failure (real disk)", () => {
		let dir: string;

		beforeEach(async () => {
			dir = await mkdtemp(join(tmpdir(), "hashline-partial-"));
		});
		afterEach(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		it("surfaces written/failed/notAttempted categories and warns when the failed section is an MV", async () => {
			const a = join(dir, "a.txt");
			const b = join(dir, "b.txt");
			const c = join(dir, "c.txt");
			const missingDest = join(dir, "missing", "dest.txt");
			await writeFile(a, "A_OLD\n");
			await writeFile(b, "B_OLD\n");
			await writeFile(c, "C_OLD\n");

			const { NodeFilesystem } = await import("../src/node-filesystem");
			const fs = new NodeFilesystem();
			const snapshots = new InMemorySnapshotStore();
			const edit = createHashlineEdit({ fs, snapshots });

			const tagA = computeFileHash("A_OLD\n");
			const tagB = computeFileHash("B_OLD\n");
			const tagC = computeFileHash("C_OLD\n");
			const input = [
				`[${a}#${tagA}]`,
				"SWAP 1.=1:",
				"+A_NEW",
				`[${b}#${tagB}]`,
				`MV ${missingDest}`,
				`[${c}#${tagC}]`,
				"SWAP 1.=1:",
				"+C_NEW",
			].join("\n");

			const result = await runEdit(edit, input);

			// Failed batch — surfaced as an error.
			expect(result.isError).toBe(true);
			// §1 (a.txt) was already written before the failure.
			const { readFile } = await import("node:fs/promises");
			expect(await readFile(a, "utf-8")).toBe("A_NEW\n");
			// §3 (c.txt) was never attempted — still original content.
			expect(await readFile(c, "utf-8")).toBe("C_OLD\n");

			// Three categories must be distinguishable in the message:
			//   written: a.txt | failed: b.txt (in the "Failed to write" prefix) | notAttempted: c.txt
			expect(result.text).toMatch(new RegExp(`Failed to write ${escapeRe(b)}`));
			expect(result.text).toMatch(new RegExp(`already written: ${escapeRe(a)}`));
			expect(result.text).toMatch(new RegExp(`not written: ${escapeRe(c)}`));
			// MV-specific warning: the source may still exist on disk.
			expect(result.text).toMatch(/MV/i);
			expect(result.text).toMatch(/source may still exist/i);
			// The failed MV source (b.txt) was not deleted because the dest write failed first.
			expect(await readFile(b, "utf-8")).toBe("B_OLD\n");
		});

		it("warns on a single-section failed MV (fast path has no `Failed to write` prefix)", async () => {
			// The patcher's single-section fast path calls commit() directly and
			// lets the raw error through WITHOUT the `Failed to write <path>:`
			// prefix the multi-section path adds. The MV warning must still fire,
			// because commit() relocates snapshots before fs.move() for an MV —
			// a single-section move failure can leave disk/snapshot ambiguous too.
			const b = join(dir, "b.txt");
			const missingDest = join(dir, "missing", "dest.txt");
			await writeFile(b, "B_OLD\n");

			const { NodeFilesystem } = await import("../src/node-filesystem");
			const fs = new NodeFilesystem();
			const snapshots = new InMemorySnapshotStore();
			const edit = createHashlineEdit({ fs, snapshots });

			const tagB = computeFileHash("B_OLD\n");
			const input = [`[${b}#${tagB}]`, `MV ${missingDest}`].join("\n");

			const result = await runEdit(edit, input);

			expect(result.isError).toBe(true);
			// MV-specific warning must fire even on the single-section fast path.
			expect(result.text).toMatch(/MV/i);
			expect(result.text).toMatch(/source may still exist/i);
			// Source was not deleted because the dest write failed first.
			const { readFile } = await import("node:fs/promises");
			expect(await readFile(b, "utf-8")).toBe("B_OLD\n");
		});
	});
});

describe("hashline_edit — dryRun preview", () => {
	it("returns the would-be new tag + op and writes nothing", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tag = computeFileHash("before\n");

		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+after`, true);

		expect(result.isError).toBeFalsy();
		// File untouched — nothing written, no snapshot recorded.
		expect(fs.get("a.txt")).toBe("before\n");
		// Preview marker present.
		expect(result.text).toContain("preview — not written");
		// Predicted op + tag match what a real apply would emit.
		expect(result.text).toContain("update");
		expect(result.text).toContain(`[a.txt#${computeFileHash("after\n")}]`);
	});

	it("records no snapshot: the same input still applies cleanly afterward", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tag = computeFileHash("before\n");
		const input = `[a.txt#${tag}]\nSWAP 1.=1:\n+after`;

		const preview = await runEdit(edit, input, true);
		expect(preview.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("before\n");
		expect(snapshots.head("a.txt")).toBeNull(); // success path records no snapshot

		// The original tag still validates after the preview (nothing recorded).
		const apply = await runEdit(edit, input);
		expect(apply.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("after\n");
		// Real apply emits the same tag the preview predicted.
		expect(apply.text).toContain(`[a.txt#${computeFileHash("after\n")}]`);
	});

	it("returns a noop preview for a single-section no-op (matches apply, no throw)", async () => {
		// apply's single-section fast path returns op:"noop" instead of throwing;
		// the preview mirrors that split (no-op throw is multi-section only).
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tag = computeFileHash("before\n");

		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+before`, true);

		expect(result.isError).toBeFalsy();
		expect(result.text).toContain("noop:");
		expect(result.text).toContain("preview — not written");
		expect(fs.get("a.txt")).toBe("before\n");
		expect(snapshots.head("a.txt")).toBeNull(); // no record on the success path
	});

	it("throws on a no-op section within a multi-section batch (same error as a real apply)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "A\n"], ["b.txt", "B\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const tagA = computeFileHash("A\n");
		const tagB = computeFileHash("B\n");
		// b.txt's SWAP reproduces the existing content → no-op section.
		const input = `[a.txt#${tagA}]\nSWAP 1.=1:\n+A2\n[b.txt#${tagB}]\nSWAP 1.=1:\n+B`;

		const result = await runEdit(edit, input, true);

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/no changes/);
		expect(fs.get("a.txt")).toBe("A\n");
		expect(fs.get("b.txt")).toBe("B\n");
	});

	it("throws on a stale tag (same error as a real apply)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "current\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots });
		const live = computeFileHash("current\n");
		const bogus = live === "FFFF" ? "0000" : "FFFF";

		const result = await runEdit(edit, `[a.txt#${bogus}]\nSWAP 1.=1:\n+after`, true);

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/not from this session/);
		expect(fs.get("a.txt")).toBe("current\n");
		// Mismatch parity with apply: #mismatchError records the live content as a
		// recovery snapshot (vendored, not suppressible from the wrapper).
		expect(snapshots.head("a.txt")?.hash).toBe(computeFileHash("current\n"));
	});

	it("throws on duplicate-canonical-path sections (same error as a real apply)", async () => {
		const { mkdtemp, rm, readFile, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const dir = await mkdtemp(join(tmpdir(), "hashline-dry-"));
		try {
			const a = join(dir, "a.txt");
			const aAlias = `${dir}/./a.txt`; // different string, same canonical path (path.join would collapse the `.`)
			await writeFile(a, "A\n");
			const { NodeFilesystem } = await import("../src/node-filesystem");
			const fs = new NodeFilesystem();
			const snapshots = new InMemorySnapshotStore();
			const edit = createHashlineEdit({ fs, snapshots });
			const tag = computeFileHash("A\n");
			const input = `[${a}#${tag}]\nSWAP 1.=1:\n+A1\n[${aAlias}#${tag}]\nSWAP 1.=1:\n+A2`;

			const result = await runEdit(edit, input, true);

			expect(result.isError).toBe(true);
			expect(result.text).toMatch(/Merge their ops under one header/);
			expect(await readFile(a, "utf-8")).toBe("A\n"); // nothing written
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("does not run the LSP diagnostics pass (nothing written)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const calls: { dst: string; content: string }[] = [];
		const writethrough: WritethroughCallback = async (dst, content) => {
			calls.push({ dst, content });
			return { server: "tsls", messages: [], summary: "OK", errored: false };
		};
		const edit = createHashlineEdit({
			fs,
			snapshots,
			diagnosticsSource: { forHashlineEdit: async () => writethrough },
		});
		const tag = computeFileHash("before\n");

		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+after`, true);

		expect(result.isError).toBeFalsy();
		expect(calls).toHaveLength(0);
		expect(result.text).not.toContain("diagnostics:");
		expect(fs.get("a.txt")).toBe("before\n");
	});
});

describe("hashline_edit — LSP diagnostics pass", () => {
	function makeDiag(over: Partial<FileDiagnosticsResult> = {}): FileDiagnosticsResult {
		return { server: "tsls", messages: [], summary: "OK", errored: false, ...over };
	}

	it("runs a diagnostics-only pass on SWAP (update) sections and appends results", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const calls: { dst: string; content: string }[] = [];
		const writethrough: WritethroughCallback = async (dst, content) => {
			calls.push({ dst, content });
			return makeDiag({ summary: "1 error(s)", messages: ["a.txt:1:1: oops"], errored: true });
		};
		const edit = createHashlineEdit({
			fs,
			snapshots,
			diagnosticsSource: { forHashlineEdit: async () => writethrough },
		});
		const tag = computeFileHash("before\n");
		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+after`);

		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("after\n");
		// diagnostics pass invoked once on the affected file with the post-edit content.
		expect(calls).toHaveLength(1);
		expect(calls[0].content).toBe("after\n");
		// diagnostics appended to the result text.
		expect(result.text).toContain("diagnostics: 1 error(s)");
		expect(result.text).toContain("oops");
	});

	it("skips the diagnostics pass on REM (delete) sections", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const calls: { dst: string; content: string }[] = [];
		const writethrough: WritethroughCallback = async (dst, content) => {
			calls.push({ dst, content });
			return makeDiag();
		};
		const edit = createHashlineEdit({
			fs,
			snapshots,
			diagnosticsSource: { forHashlineEdit: async () => writethrough },
		});
		const tag = computeFileHash("before\n");
		const result = await runEdit(edit, `[a.txt#${tag}]\nREM`);

		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBeUndefined();
		expect(calls).toHaveLength(0); // REM skipped (file gone)
		expect(result.text).not.toContain("diagnostics:");
	});

	it("skips the diagnostics pass on MV sections (source gone/renamed)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const calls: { dst: string; content: string }[] = [];
		const writethrough: WritethroughCallback = async (dst, content) => {
			calls.push({ dst, content });
			return makeDiag();
		};
		const edit = createHashlineEdit({
			fs,
			snapshots,
			diagnosticsSource: { forHashlineEdit: async () => writethrough },
		});
		const tag = computeFileHash("before\n");
		const result = await runEdit(edit, `[a.txt#${tag}]\nMV b.txt`);

		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBeUndefined();
		expect(fs.get("b.txt")).toBe("before\n");
		expect(calls).toHaveLength(0); // MV skipped
	});

	it("does not run the pass when no diagnostics source is injected", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const edit = createHashlineEdit({ fs, snapshots }); // no diagnosticsSource
		const tag = computeFileHash("before\n");
		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+after`);

		expect(result.isError).toBeFalsy();
		expect(result.text).not.toContain("diagnostics:");
	});

	it("skips the pass when the source returns undefined (LSP disabled)", async () => {
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		let consulted = false;
		const edit = createHashlineEdit({
			fs,
			snapshots,
			diagnosticsSource: {
				forHashlineEdit: async () => {
					consulted = true;
					return undefined;
				},
			},
		});
		const tag = computeFileHash("before\n");
		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+after`);

		expect(result.isError).toBeFalsy();
		expect(consulted).toBe(true); // source consulted
		expect(result.text).not.toContain("diagnostics:"); // but no pass run
	});

	it("never formats: the writethrough receives the unchanged post-edit content, preserving the returned tag", async () => {
		// The diagnostics writethrough is enableFormat:false; the file on disk must
		// equal the post-edit content so the returned [path#TAG] stays valid.
		const fs = new InMemoryFilesystem([["a.txt", "before\n"]]);
		const snapshots = new InMemorySnapshotStore();
		const seen: string[] = [];
		const writethrough: WritethroughCallback = async (_dst, content) => {
			seen.push(content);
			return makeDiag();
		};
		const edit = createHashlineEdit({
			fs,
			snapshots,
			diagnosticsSource: { forHashlineEdit: async () => writethrough },
		});
		const tag = computeFileHash("before\n");
		const result = await runEdit(edit, `[a.txt#${tag}]\nSWAP 1.=1:\n+after`);

		expect(result.isError).toBeFalsy();
		expect(fs.get("a.txt")).toBe("after\n");
		expect(seen).toEqual(["after\n"]); // unchanged — no formatting
		// Returned tag matches the on-disk content (tag integrity preserved).
		const returnedTag = result.text.match(/#([0-9a-fA-F]{4})/)?.[1];
		expect(returnedTag).toBe(computeFileHash("after\n"));
	});
});

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
