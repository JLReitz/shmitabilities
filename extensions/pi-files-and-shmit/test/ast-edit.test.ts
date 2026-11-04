/**
 * Tests for the JS-side `ast_edit` tool.
 *
 * The native `astRewrite` boundary is covered in `native.test.ts`; these
 * tests exercise the TypeScript layer: the `dryRun` two-call flow, per-file
 * before/after preview, the TOCTOU content-hash re-check on apply, no-op
 * write skipping, multi-file aggregation, maxReplacements/maxFiles caps, and
 * error signaling. Fixtures are written to a temp dir so the tests are
 * hermetic.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createAstEdit } from "../src/ast-edit";
import type { WritethroughCallback } from "../src/vendor/lsp";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "ast-edit-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function runEdit(params: Record<string, unknown>, cwd: string) {
	const tool = createAstEdit();
	const result = await tool.execute("id", params as any, undefined, undefined, { cwd });
	const text = result.content[0].text;
	return { raw: result, parsed: JSON.parse(text) };
}

/** Run an apply with an injected writethrough source. Returns the recorded
 * writethrough calls so the test can assert routing. The wrapped callback
 * writes the content itself (a stub writethrough must, so the TOCTOU-verified
 * plan lands on disk and the file assertions hold), then delegates to the
 * inner writethrough. */
async function runEditWithWritethrough(
	params: Record<string, unknown>,
	cwd: string,
	writethrough: WritethroughCallback,
) {
	const calls: { dst: string; content: string }[] = [];
	const wrapped: WritethroughCallback = async (dst, content, signal) => {
		calls.push({ dst, content });
		await writeFile(dst, content, "utf-8");
		return writethrough(dst, content, signal);
	};
	const tool = createAstEdit({
		writethroughSource: { forAstEdit: async () => wrapped },
	});
	const result = await tool.execute("id", params as any, undefined, undefined, { cwd });
	const text = result.content[0].text;
	return { raw: result, parsed: JSON.parse(text), calls };
}

describe("ast_edit tool — dryRun (preview)", () => {
	it("returns a per-file before/after diff and writes nothing", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "console.log('x');\nconsole.log('y');\n");

			const { parsed } = await runEdit(
				{ rewrites: { "console.log($$$ARGS)": "log($$$ARGS)" }, path: dir, dryRun: true },
				dir,
			);
			expect(parsed.applied).toBe(false);
			expect(parsed.totalReplacements).toBe(2);
			expect(parsed.filesTouched).toBe(1);
			expect(parsed.filesSearched).toBe(1);
			expect(parsed.changes).toHaveLength(2);
			expect(parsed.changes[0].path).toBe("a.js");
			expect(parsed.changes[0].before).toBe("console.log('x')");
			expect(parsed.changes[0].after).toBe("log('x')");
			// previewHashes carries the original content hash for the apply TOCTOU check.
			expect(parsed.previewHashes).toBeDefined();
			expect(Object.keys(parsed.previewHashes)).toEqual(["a.js"]);

			// Nothing written.
			const after = await readFile(join(dir, "a.js"), "utf-8");
			expect(after).toBe("console.log('x');\nconsole.log('y');\n");
		});
	});

	it("aggregates changes across multiple files and reports per-file counts", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await writeFile(join(dir, "b.js"), "foo(2);\nfoo(3);\n");

			const { parsed } = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			expect(parsed.totalReplacements).toBe(3);
			expect(parsed.filesTouched).toBe(2);
			expect(parsed.fileChanges).toContainEqual({ path: "a.js", count: 1 });
			expect(parsed.fileChanges).toContainEqual({ path: "b.js", count: 2 });
			expect(Object.keys(parsed.previewHashes).sort()).toEqual(["a.js", "b.js"]);
		});
	});

	it("omits a file from previewHashes when it has no matches", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "hit.js"), "foo(1);\n");
			await writeFile(join(dir, "miss.js"), "const x = 1;\n");

			const { parsed } = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			expect(parsed.totalReplacements).toBe(1);
			expect(Object.keys(parsed.previewHashes)).toEqual(["hit.js"]);
		});
	});

	it("omits a file with parse errors from previewHashes (file is skipped, not partially rewritten)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "ok.js"), "foo(1);\n");
			await writeFile(join(dir, "broken.js"), "foo(2);\nbar(\n");

			const { parsed } = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			// Only the clean file is affected; the parse-error file is skipped
			// entirely (mirrors upstream ast_edit_blocking) and never appears in
			// previewHashes, so apply won't try to write it.
			expect(parsed.totalReplacements).toBe(1);
			expect(Object.keys(parsed.previewHashes)).toEqual(["ok.js"]);
			expect(parsed.parseErrors).toBeDefined();
			expect(parsed.parseErrors.some((e: string) => e.includes("broken.js"))).toBe(true);
		});
	});

	it("honors a glob filter relative to the search path", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(join(dir, "src", "hit.ts"), "foo(1);\n");
			await writeFile(join(dir, "skip.js"), "foo(2);\n");

			const { parsed } = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, glob: "**/*.ts", dryRun: true },
				dir,
			);
			expect(parsed.filesSearched).toBe(1);
			expect(parsed.totalReplacements).toBe(1);
			expect(parsed.changes[0].path).toBe("src/hit.ts");
		});
	});

	it("defaults dryRun to true (omitting it does not write)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");

			const { parsed } = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir },
				dir,
			);
			expect(parsed.applied).toBe(false);
			expect(parsed.previewHashes).toBeDefined();
			const after = await readFile(join(dir, "a.js"), "utf-8");
			expect(after).toBe("foo(1);\n");
		});
	});
});

describe("ast_edit tool — apply (dryRun: false)", () => {
	it("applies all edits after an unchanged preview", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "console.log('x');\n");

			const preview = await runEdit(
				{ rewrites: { "console.log($$$ARGS)": "log($$$ARGS)" }, path: dir, dryRun: true },
				dir,
			);
			expect(preview.parsed.applied).toBe(false);

			const applied = await runEdit(
				{
					rewrites: { "console.log($$$ARGS)": "log($$$ARGS)" },
					path: dir,
					dryRun: false,
					previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
				},
				dir,
			);
			expect(applied.parsed.applied).toBe(true);
			expect(applied.parsed.totalReplacements).toBe(1);
			expect(applied.parsed.previewHashes).toBeUndefined();

			const onDisk = await readFile(join(dir, "a.js"), "utf-8");
			expect(onDisk).toBe("log('x');\n");
		});
	});

	it("applies edits across multiple files after an unchanged preview", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await writeFile(join(dir, "b.js"), "foo(2);\n");

			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			const applied = await runEdit(
				{
					rewrites: { "foo($X)": "bar($X)" },
					path: dir,
					dryRun: false,
					previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
				},
				dir,
			);
			expect(applied.parsed.applied).toBe(true);
			expect(applied.parsed.filesTouched).toBe(2);
			expect(await readFile(join(dir, "a.js"), "utf-8")).toBe("bar(1);\n");
			expect(await readFile(join(dir, "b.js"), "utf-8")).toBe("bar(2);\n");
		});
	});

	it("fails with 'files changed since preview' and writes nothing when a file drifts", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await writeFile(join(dir, "b.js"), "foo(2);\n");

			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			// TOCTOU: mutate a.js between preview and apply.
			await writeFile(join(dir, "a.js"), "foo(1); foo(99);\n");

			await expect(
				runEdit(
					{
						rewrites: { "foo($X)": "bar($X)" },
						path: dir,
						dryRun: false,
						previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
					},
					dir,
				),
			).rejects.toThrow(/files changed since preview/i);

			// Nothing written: b.js is still the original content (not bar(2)).
			expect(await readFile(join(dir, "b.js"), "utf-8")).toBe("foo(2);\n");
			// a.js keeps the externally-mutated content (no partial write).
			expect(await readFile(join(dir, "a.js"), "utf-8")).toBe("foo(1); foo(99);\n");
		});
	});

	it("fails when a preview-affected file no longer matches (set of affected files differs)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");

			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			// Drift a.js so the pattern no longer matches → affected set shrinks.
			await writeFile(join(dir, "a.js"), "const z = 1;\n");

			await expect(
				runEdit(
					{
						rewrites: { "foo($X)": "bar($X)" },
						path: dir,
						dryRun: false,
						previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
					},
					dir,
				),
			).rejects.toThrow(/files changed since preview/i);
		});
	});

	it("requires previewHashes when dryRun is false", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await expect(
				runEdit(
					{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: false },
					dir,
				),
			).rejects.toThrow(/previewHashes/);
		});
	});

	it("requires planDigest when dryRun is false (even with previewHashes present)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			// previewHashes present but planDigest omitted → refuse to apply.
			await expect(
				runEdit(
					{
						rewrites: { "foo($X)": "bar($X)" },
						path: dir,
						dryRun: false,
						previewHashes: preview.parsed.previewHashes,
					},
					dir,
				),
			).rejects.toThrow(/planDigest/);
		});
	});

	it("fails with planDigest mismatch when the rewrite plan changed between preview and apply", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			// Preview with foo->bar.
			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			// Apply with foo->baz (different rewrite) but the SAME previewHashes and
			// the OLD planDigest. The recomputed planDigest differs from the
			// passed-in one, so the apply is refused before any write.
			await expect(
				runEdit(
					{
						rewrites: { "foo($X)": "baz($X)" },
						path: dir,
						dryRun: false,
						previewHashes: preview.parsed.previewHashes,
						planDigest: preview.parsed.planDigest,
					},
					dir,
				),
			).rejects.toThrow(/plan changed since preview|planDigest mismatch/i);
			// Nothing written.
			expect(await readFile(join(dir, "a.js"), "utf-8")).toBe("foo(1);\n");
		});
	});

	it("fails with planDigest mismatch when the rewrite ORDER changes under a cap (rule order is plan-affecting)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1); bar(2);\n");
			// Preview with rule order [foo->baz, bar->qux] under a cap of 1.
			// Insertion order matters: foo matches first and consumes the cap.
			const preview = await runEdit(
				{
					rewrites: { "foo($X)": "baz($X)", "bar($X)": "qux($X)" },
					path: dir,
					dryRun: true,
					maxReplacements: 1,
				},
				dir,
			);
			expect(preview.parsed.totalReplacements).toBe(1);
			// Apply with the SAME rewrites but REVERSED order under the same cap.
			// Rule order is part of the planDigest, so the apply is refused before
			// any write — without this, the reversed order would replace bar first
			// instead of foo, writing an unpreviewed edit.
			await expect(
				runEdit(
					{
						rewrites: { "bar($X)": "qux($X)", "foo($X)": "baz($X)" },
						path: dir,
						dryRun: false,
						maxReplacements: 1,
						previewHashes: preview.parsed.previewHashes,
						planDigest: preview.parsed.planDigest,
					},
					dir,
				),
			).rejects.toThrow(/plan changed since preview|planDigest mismatch/i);
			expect(await readFile(join(dir, "a.js"), "utf-8")).toBe("foo(1); bar(2);\n");
		});
	});

	it("skips no-op writes (rewrite produces identical content)", async () => {
		await withTempDir(async (dir) => {
			// Pattern matches `foo(1)` but the rewrite is the same text → no-op.
			await writeFile(join(dir, "a.js"), "foo(1);\n");

			const preview = await runEdit(
				{ rewrites: { "foo($X)": "foo($X)" }, path: dir, dryRun: true },
				dir,
			);
			// The native layer reports replacements (pattern matched), but the
			// rewritten text equals the original. Apply still succeeds.
			const applied = await runEdit(
				{
					rewrites: { "foo($X)": "foo($X)" },
					path: dir,
					dryRun: false,
					previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
				},
				dir,
			);
			expect(applied.parsed.applied).toBe(true);
			expect(await readFile(join(dir, "a.js"), "utf-8")).toBe("foo(1);\n");
		});
	});

	it("supports an explicit lang override", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "snippet.txt"), "foo(1);\n");
			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, lang: "js", dryRun: true },
				dir,
			);
			expect(preview.parsed.totalReplacements).toBe(1);
			const applied = await runEdit(
				{
					rewrites: { "foo($X)": "bar($X)" },
					path: dir,
					lang: "js",
					dryRun: false,
					previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
				},
				dir,
			);
			expect(applied.parsed.applied).toBe(true);
			expect(await readFile(join(dir, "snippet.txt"), "utf-8")).toBe("bar(1);\n");
		});
	});
});

describe("ast_edit tool — limits and validation", () => {
	it("honors maxReplacements across files and reports limitReached", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\nfoo(2);\n");
			await writeFile(join(dir, "b.js"), "foo(3);\n");

			const { parsed } = await runEdit(
				{
					rewrites: { "foo($X)": "bar($X)" },
					path: dir,
					dryRun: true,
					maxReplacements: 2,
				},
				dir,
			);
			expect(parsed.totalReplacements).toBe(2);
			expect(parsed.limitReached).toBe(true);
		});
	});

	it("honors maxFiles", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await writeFile(join(dir, "b.js"), "foo(2);\n");
			await writeFile(join(dir, "c.js"), "foo(3);\n");

			const { parsed } = await runEdit(
				{
					rewrites: { "foo($X)": "bar($X)" },
					path: dir,
					dryRun: true,
					maxFiles: 2,
				},
				dir,
			);
			expect(parsed.filesTouched).toBe(2);
			expect(parsed.limitReached).toBe(true);
		});
	});

	it("throws when rewrites is empty", async () => {
		await withTempDir(async (dir) => {
			await expect(
				runEdit({ rewrites: {}, path: dir, dryRun: true }, dir),
			).rejects.toThrow(/rewrites/);
		});
	});

	it("throws on an invalid strictness", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await expect(
				runEdit(
					{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true, strictness: "klingon" },
					dir,
				),
			).rejects.toThrow(/strictness/);
		});
	});

	it("throws on an invalid explicit lang", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await expect(
				runEdit(
					{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true, lang: "klingon" },
					dir,
				),
			).rejects.toThrow(/Unsupported language/);
		});
	});
});

describe("ast_edit tool — LSP writethrough wiring", () => {
	it("routes apply writes through the injected writethrough (one call per affected file)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await writeFile(join(dir, "b.js"), "foo(2);\n");
			const noopWritethrough: WritethroughCallback = async () => undefined;

			const preview = await runEdit(
				{ rewrites: { "foo($X)": "bar($X)" }, path: dir, dryRun: true },
				dir,
			);
			const { parsed, calls } = await runEditWithWritethrough(
				{
					rewrites: { "foo($X)": "bar($X)" },
					path: dir,
					dryRun: false,
					previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
				},
				dir,
				noopWritethrough,
			);
			expect(parsed.applied).toBe(true);
			expect(parsed.filesTouched).toBe(2);
			// The writethrough was invoked exactly once per affected file, with the
			// absolute path and the rewritten (pre-format) output.
			expect(calls).toHaveLength(2);
			for (const c of calls) {
				expect(resolve(c.dst)).toBe(resolve(dir, basename(c.dst)));
				expect(c.content).toMatch(/^bar\(\d\);\n$/);
			}
			// The wrapped callback wrote the content, so disk reflects the rewrite.
			expect(await readFile(join(dir, "a.js"), "utf-8")).toBe("bar(1);\n");
			expect(await readFile(join(dir, "b.js"), "utf-8")).toBe("bar(2);\n");
		});
	});

	it("skips the writethrough for no-op writes (rewrite produces identical content)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			const calls: { dst: string; content: string }[] = [];
			const writethrough: WritethroughCallback = async (dst, content) => {
				calls.push({ dst, content });
				await writeFile(dst, content, "utf-8");
				return undefined;
			};
			// Pattern matches but rewrite yields identical text → no write.
			const preview = await runEdit(
				{ rewrites: { "foo($X)": "foo($X)" }, path: dir, dryRun: true },
				dir,
			);
			const { parsed, calls: routed } = await runEditWithWritethrough(
				{
					rewrites: { "foo($X)": "foo($X)" },
					path: dir,
					dryRun: false,
					previewHashes: preview.parsed.previewHashes,
					planDigest: preview.parsed.planDigest,
				},
				dir,
				writethrough,
			);
			expect(parsed.applied).toBe(true);
			expect(parsed.filesTouched).toBe(1);
			expect(routed).toHaveLength(0);
			expect(calls).toHaveLength(0);
		});
	});
});
