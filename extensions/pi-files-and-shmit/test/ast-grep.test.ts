/**
 * Tests for the JS-side `ast_grep` tool.
 *
 * The native `astMatch` boundary is covered in `native.test.ts`; these tests
 * exercise the TypeScript layer: file discovery via `glob`, per-file language
 * resolution via `resolveLanguage`, aggregation across files, global
 * offset/limit paging, node_modules default-ignore, the single-file `path`
 * shortcut, and parse-error collection. Fixtures are written to a temp dir so
 * the tests are hermetic.
 */
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAstGrep } from "../src/ast-grep";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "ast-grep-"));
	try {
		return await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function runGrep(params: Record<string, unknown>, cwd: string) {
	const tool = createAstGrep();
	const result = await tool.execute("id", params as any, undefined, undefined, { cwd });
	const text = result.content[0].text;
	return { raw: result, parsed: JSON.parse(text) };
}

describe("ast_grep tool", () => {
	it("aggregates matches across files in a directory", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "console.log('a');\nconsole.log('b');\n");
			await writeFile(join(dir, "b.js"), "console.log('c');\n");

			const { parsed } = await runGrep(
				{ patterns: ["console.log($$$)"], path: dir },
				dir,
			);
			expect(parsed.totalMatches).toBe(3);
			expect(parsed.filesWithMatches).toBe(2);
			expect(parsed.filesSearched).toBe(2);
			expect(parsed.limitReached).toBe(false);
			// Display paths are cwd-relative.
			const paths = parsed.matches.map((m: any) => m.path).sort();
			expect(paths).toEqual(["a.js", "a.js", "b.js"]);
			// Each match carries 1-based line/column coordinates.
			const first = parsed.matches[0];
			expect(first.startLine).toBeGreaterThan(0);
			expect(first.startColumn).toBeGreaterThan(0);
			expect(typeof first.byteStart).toBe("number");
		});
	});

	it("sorts matches by path then position", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "z.js"), "foo(1);\n");
			await writeFile(join(dir, "a.js"), "foo(2);\nfoo(3);\n");

			const { parsed } = await runGrep({ patterns: ["foo($X)"], path: dir }, dir);
			const labels = parsed.matches.map((m: any) => `${m.path}:${m.text}`).join(",");
			expect(labels).toBe("a.js:foo(2),a.js:foo(3),z.js:foo(1)");
		});
	});

	it("applies a glob filter relative to the search path", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, "src"), { recursive: true });
			await writeFile(join(dir, "src", "match.ts"), "console.log('x');\n");
			await writeFile(join(dir, "skip.js"), "console.log('y');\n");

			const { parsed } = await runGrep(
				{ patterns: ["console.log($$$)"], path: dir, glob: "**/*.ts" },
				dir,
			);
			expect(parsed.filesSearched).toBe(1);
			expect(parsed.totalMatches).toBe(1);
			expect(parsed.matches[0].path).toBe("src/match.ts");
		});
	});

	it("ignores node_modules by default", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
			await writeFile(join(dir, "node_modules", "pkg", "dep.js"), "console.log('dep');\n");
			await writeFile(join(dir, "app.js"), "console.log('app');\n");

			const { parsed } = await runGrep({ patterns: ["console.log($$$)"], path: dir }, dir);
			expect(parsed.filesSearched).toBe(1);
			expect(parsed.matches[0].path).toBe("app.js");
		});
	});

	it("opts into scanning node_modules when the glob mentions it", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
			await writeFile(join(dir, "node_modules", "pkg", "dep.js"), "console.log('dep');\n");
			await writeFile(join(dir, "app.js"), "console.log('app');\n");

			const { parsed } = await runGrep(
				{ patterns: ["console.log($$$)"], path: dir, glob: "**/node_modules/**/*.js" },
				dir,
			);
			expect(parsed.filesSearched).toBe(1);
			expect(parsed.matches[0].path).toBe("node_modules/pkg/dep.js");
		});
	});

	it("scans a single file when path is a file", async () => {
		await withTempDir(async (dir) => {
			const file = join(dir, "one.js");
			await writeFile(file, "foo(1);\nfoo(2);\n");

			const { parsed } = await runGrep({ patterns: ["foo($X)"], path: file }, dir);
			expect(parsed.totalMatches).toBe(2);
			expect(parsed.filesSearched).toBe(1);
			expect(parsed.matches[0].path).toBe("one.js");
		});
	});

	it("infers language per file and skips unsupported extensions", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "ok.py"), "print('hi')\n");
			await writeFile(join(dir, "data.txt"), "print('no')\n"); // unsupported

			const { parsed } = await runGrep(
				{ patterns: ["print($X)"], path: dir },
				dir,
			);
			expect(parsed.filesSearched).toBe(2);
			expect(parsed.totalMatches).toBe(1);
			expect(parsed.matches[0].path).toBe("ok.py");
		});
	});

	it("applies an explicit lang override to all files", async () => {
		await withTempDir(async (dir) => {
			// .txt files would normally be skipped; with lang=js they parse as JS.
			await writeFile(join(dir, "a.txt"), "console.log('x');\n");

			const { parsed } = await runGrep(
				{ patterns: ["console.log($$$)"], path: dir, lang: "js" },
				dir,
			);
			expect(parsed.totalMatches).toBe(1);
			expect(parsed.matches[0].path).toBe("a.txt");
		});
	});

	it("applies global offset and limit across all files", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\nfoo(2);\n");
			await writeFile(join(dir, "b.js"), "foo(3);\nfoo(4);\nfoo(5);\n");

			const { parsed } = await runGrep(
				{ patterns: ["foo($X)"], path: dir, offset: 1, limit: 2 },
				dir,
			);
			expect(parsed.totalMatches).toBe(5);
			expect(parsed.matches.map((m: any) => m.text)).toEqual(["foo(2)", "foo(3)"]);
			expect(parsed.limitReached).toBe(true);
		});
	});

	it("includes meta-variables when includeMeta is true", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(42);\n");

			const { parsed } = await runGrep(
				{ patterns: ["foo($A)"], path: dir, includeMeta: true },
				dir,
			);
			expect(parsed.matches[0].metaVariables).toEqual({ A: "42" });
		});
	});

	it("collects parse errors per file without failing the run", async () => {
		await withTempDir(async (dir) => {
			// Syntax error (unclosed paren) → tree-sitter error node → parseErrors.
			await writeFile(join(dir, "broken.js"), "console.log('x'\n");
			await writeFile(join(dir, "ok.js"), "console.log('y');\n");

			const { parsed } = await runGrep(
				{ patterns: ["console.log($$$)"], path: dir },
				dir,
			);
			expect(parsed.parseErrors).toBeDefined();
			expect(parsed.parseErrors.length).toBeGreaterThan(0);
			// The good file still matched.
			expect(parsed.totalMatches).toBeGreaterThanOrEqual(1);
		});
	});

	it("throws on an empty patterns array", async () => {
		await withTempDir(async (dir) => {
			await expect(runGrep({ patterns: [], path: dir }, dir)).rejects.toThrow(/patterns/);
		});
	});

	it("throws on an invalid strictness value", async () => {
		await withTempDir(async (dir) => {
			await expect(
				runGrep({ patterns: ["console.log($$$)"], path: dir, strictness: "bogus" }, dir),
			).rejects.toThrow(/strictness/);
		});
	});

	it("throws on an invalid explicit lang", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "console.log('x');\n");
			await expect(
				runGrep({ patterns: ["console.log($$$)"], path: dir, lang: "klingon" }, dir),
			).rejects.toThrow(/Unsupported language/);
		});
	});

	it("returns an empty result for a path with no matching files", async () => {
		await withTempDir(async (dir) => {
			const { parsed } = await runGrep(
				{ patterns: ["console.log($$$)"], path: dir },
				dir,
			);
			expect(parsed.totalMatches).toBe(0);
			expect(parsed.matches).toEqual([]);
			expect(parsed.filesSearched).toBe(0);
			expect(parsed.limitReached).toBe(false);
		});
	});

	it("defaults the search root to the session cwd when path is omitted", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "root.js"), "console.log('cwd');\n");

			const { parsed } = await runGrep({ patterns: ["console.log($$$)"] }, dir);
			expect(parsed.totalMatches).toBe(1);
			expect(parsed.matches[0].path).toBe("root.js");
		});
	});

	it("includes hidden (dotfile) files in directory scans", async () => {
		// Upstream scans with include_hidden: true; here only
		// node_modules/.git are default-ignored. A dotfile JS config must match.
		await withTempDir(async (dir) => {
			await writeFile(join(dir, ".eslintrc.js"), "console.log('hidden');\n");
			await writeFile(join(dir, ".bashrc"), "echo hi\n");
			await writeFile(join(dir, "visible.js"), "console.log('v');\n");

			const { parsed } = await runGrep({ patterns: ["console.log($$$)"], path: dir }, dir);
			const paths = parsed.matches.map((m: any) => m.path).sort();
			expect(paths).toContain(".eslintrc.js");
			expect(paths).toContain("visible.js");
			expect(parsed.filesSearched).toBeGreaterThanOrEqual(2);
		});
	});

	it("includes hidden shell dotfiles matched by extension/rc-name", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, ".bashrc"), "foo(1)\n");

			const { parsed } = await runGrep({ patterns: ["foo($X)"], path: dir }, dir);
			expect(parsed.totalMatches).toBe(1);
			expect(parsed.matches[0].path).toBe(".bashrc");
		});
	});

	it("discovers and infers C / C++ / CMake files from extensions", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "main.c"), "int add(int a, int b) { return a + b; }\n");
			await writeFile(join(dir, "widget.cpp"), "namespace ns { class W {}; }\n");
			await writeFile(join(dir, "CMakeLists.txt"), "message(STATUS hi)\n");
			// Each file's language is inferred per-file by `resolveLanguage`, then
			// the matching pattern is compiled for that grammar.
			const { parsed } = await runGrep(
				{ patterns: ["message($$$ARGS)"], path: dir },
				dir,
			);
			expect(parsed.totalMatches).toBe(1);
			expect(parsed.matches[0].path).toBe("CMakeLists.txt");
			expect(parsed.filesSearched).toBeGreaterThanOrEqual(3);
		});
	});

	it("rejects limit: 0 (must be ≥ 1, matching upstream normalization)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await expect(
				runGrep({ patterns: ["foo($X)"], path: dir, limit: 0 }, dir),
			).rejects.toThrow(/limit/);
		});
	});

	it("rejects a negative offset (Array.slice would start from the end)", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await expect(
				runGrep({ patterns: ["foo($X)"], path: dir, offset: -1 }, dir),
			).rejects.toThrow(/offset/);
		});
	});

	it("rejects a non-integer limit", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "a.js"), "foo(1);\n");
			await expect(
				runGrep({ patterns: ["foo($X)"], path: dir, limit: 2.5 }, dir),
			).rejects.toThrow(/integer/);
		});
	});
});
