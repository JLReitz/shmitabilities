/**
 * Tests for the native `ast_match` + `resolveLanguage` addon
 * and the `ast_rewrite` addon.
 *
 * These exercise the Rust→N-API boundary directly: pattern matching on an
 * in-memory source, meta-variable capture, strictness, limit/offset paging,
 * the parse-error path, the `resolveLanguage` special-filename table
 * (Makefile → make), and the `ast_rewrite` pattern→rewrite path (meta-var
 * substitution, max_replacements cap, overlap rejection). The JS-side
 * `ast_grep` / `ast_edit` tools layer file scanning + dryRun/apply on top and
 * are covered in `ast-grep.test.ts` / `ast-edit.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { astMatch, astRewrite, resolveLanguage } from "../native";

describe("native astMatch", () => {
	it("matches a console.log call pattern in JavaScript", () => {
		const result = astMatch({
			source: "console.log('x')",
			lang: "js",
			patterns: ["console.log($$$)"],
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches).toHaveLength(1);
		const m = result.matches[0];
		expect(m.text).toBe("console.log('x')");
		expect(m.startLine).toBe(1);
		expect(m.startColumn).toBe(1);
		expect(m.endLine).toBe(1);
		expect(m.byteStart).toBe(0);
		expect(m.byteEnd).toBe("console.log('x')".length);
		expect(m.path).toBe(""); // native fills path == "" ; the JS tool sets it
		expect(result.limitReached).toBe(false);
		expect(result.parseErrors).toBeUndefined();
	});

	it("matches across multiple patterns (OR)", () => {
		const result = astMatch({
			source: "foo(1); bar(2); foo(3);",
			lang: "js",
			patterns: ["foo($A)", "bar($A)"],
		});
		expect(result.totalMatches).toBe(3);
		expect(result.matches.map((m) => m.text).sort()).toEqual(["bar(2)", "foo(1)", "foo(3)"]);
	});

	it("captures meta-variables when includeMeta is true", () => {
		const result = astMatch({
			source: "foo(42)",
			lang: "js",
			patterns: ["foo($A)"],
			includeMeta: true,
		});
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0].metaVariables).toEqual({ A: "42" });

		const noMeta = astMatch({ source: "foo(42)", lang: "js", patterns: ["foo($A)"] });
		expect(noMeta.matches[0].metaVariables).toBeUndefined();
	});

	it("matches multiple occurrences and sorts by position", () => {
		const result = astMatch({
			source: "a(1); a(2); a(3);",
			lang: "js",
			patterns: ["a($X)"],
			limit: 100,
		});
		expect(result.totalMatches).toBe(3);
		// sorted by start line then column
		expect(result.matches.map((m) => m.text)).toEqual(["a(1)", "a(2)", "a(3)"]);
	});

	it("applies offset and limit", () => {
		const result = astMatch({
			source: "a(1); a(2); a(3); a(4); a(5);",
			lang: "js",
			patterns: ["a($X)"],
			offset: 1,
			limit: 2,
		});
		expect(result.totalMatches).toBe(5);
		expect(result.matches.map((m) => m.text)).toEqual(["a(2)", "a(3)"]);
		expect(result.limitReached).toBe(true);
	});

	it("matches Rust code with the rust grammar", () => {
		const result = astMatch({
			source: "fn main() { println!(\"hi\"); }",
			lang: "rust",
			patterns: ["fn $NAME($$$ARGS) $$$BODY"],
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches[0].text).toContain("fn main");
	});

	it("matches Python code", () => {
		const result = astMatch({
			source: "def f(x):\n    return x\n",
			lang: "python",
			patterns: ["def $NAME($$$ARGS): $$$BODY"],
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches[0].metaVariables).toBeUndefined(); // includeMeta defaults to false
	});

	it("matches C function definitions with the c grammar", () => {
		// C uses the Linear-B expando char (not `$`) because `$` is invalid in C
		// identifiers; `pre_process_pattern` rewrites the sigil at compile time.
		const result = astMatch({
			source: "int add(int a, int b) { return a + b; }\n",
			lang: "c",
			patterns: ["int $NAME($$$ARGS) { $$$BODY }"],
			includeMeta: true,
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches[0].text).toContain("int add");
		expect(result.matches[0].metaVariables?.NAME).toBe("add");
	});

	it("matches C++ namespaces and classes with the cpp grammar", () => {
		const result = astMatch({
			source: "namespace foo { class Bar { public: Bar() {} }; }\n",
			lang: "cpp",
			patterns: ["namespace $NS { $$$BODY }"],
			includeMeta: true,
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches[0].metaVariables?.NS).toBe("foo");
	});

	it("matches CMake command invocations", () => {
		// In tree-sitter-cmake, `function(...)` and `endfunction()` are separate
		// command_invocation nodes (not a single wrapping node), so ast-grep
		// single-node patterns cannot span both. Each command invocation matches
		// on its own.
		const result = astMatch({
			source: "function(my_func arg)\n  message(STATUS hi)\nendfunction()\n",
			lang: "cmake",
			patterns: ["message($$$ARGS)"],
			includeMeta: true,
		});
		expect(result.totalMatches).toBe(1);
		expect(result.matches[0].text).toBe("message(STATUS hi)");
		expect(result.matches[0].metaVariables?.ARGS).toBeTruthy();
	});

	it("reports a parse error but still returns matches when the source has error nodes", () => {
		// Missing closing paren → tree-sitter flags an error node.
		const result = astMatch({
			source: "console.log('x'",
			lang: "js",
			patterns: ["console.log($$$)"],
		});
		expect(result.parseErrors).toBeDefined();
		expect(result.parseErrors!.length).toBeGreaterThan(0);
	});

	it("collects pattern-compile errors in parseErrors without throwing", () => {
		// Multiple top-level nodes is a PatternError::MultipleNode compile error,
		// reported in parseErrors rather than thrown.
		const result = astMatch({
			source: "console.log('x')",
			lang: "js",
			patterns: ["a; b;"],
		});
		expect(result.parseErrors).toBeDefined();
		expect(result.parseErrors!.length).toBeGreaterThan(0);
		expect(result.parseErrors![0]).toContain("Invalid pattern");
	});

	it("throws when lang is empty", () => {
		expect(() =>
			astMatch({ source: "x", lang: "   ", patterns: ["x"] }),
		).toThrow(/lang/);
	});

	it("throws when patterns is empty", () => {
		expect(() => astMatch({ source: "x", lang: "js", patterns: [] })).toThrow(/patterns/);
	});

	it("throws when lang is unsupported", () => {
		expect(() =>
			astMatch({ source: "x", lang: "klingon", patterns: ["x"] }),
		).toThrow(/Unsupported language/);
	});
});

describe("native astRewrite", () => {
	it("substitutes meta-variables in the rewrite template and materializes the source", () => {
		const result = astRewrite({
			source: "console.log('x'); console.log('y');\n",
			lang: "js",
			rewrites: [{ pattern: "console.log($$$ARGS)", rewrite: "log($$$ARGS)" }],
		});
		expect(result.replacements).toBe(2);
		expect(result.limitReached).toBe(false);
		expect(result.rewrittenSource).toBe("log('x'); log('y');\n");
		expect(result.changes).toHaveLength(2);
		expect(result.changes[0].before).toBe("console.log('x')");
		expect(result.changes[0].after).toBe("log('x')");
		expect(result.changes[0].byteStart).toBe(0);
		expect(result.changes[0].startLine).toBe(1);
		expect(result.changes[0].startColumn).toBe(1);
	});

	it("returns the unchanged source with zero replacements when nothing matches", () => {
		const result = astRewrite({
			source: "const x = 1;\n",
			lang: "js",
			rewrites: [{ pattern: "console.log($$$ARGS)", rewrite: "log($$$ARGS)" }],
		});
		expect(result.replacements).toBe(0);
		expect(result.changes).toHaveLength(0);
		// No matches → source returned unchanged so "rewrittenSource is None"
		// stays an unambiguous error signal (overlap / materialization failure).
		expect(result.rewrittenSource).toBe("const x = 1;\n");
	});

	it("applies multiple rewrite rules against the same parse tree", () => {
		const result = astRewrite({
			source: "foo(1); bar(2);\n",
			lang: "js",
			rewrites: [
				{ pattern: "foo($X)", rewrite: "qux($X)" },
				{ pattern: "bar($X)", rewrite: "qux($X)" },
			],
		});
		expect(result.replacements).toBe(2);
		expect(result.rewrittenSource).toBe("qux(1); qux(2);\n");
	});

	it("honors maxReplacements and reports limitReached", () => {
		const result = astRewrite({
			source: "a(1); a(2); a(3);\n",
			lang: "js",
			rewrites: [{ pattern: "a($X)", rewrite: "b($X)" }],
			maxReplacements: 2,
		});
		expect(result.replacements).toBe(2);
		expect(result.limitReached).toBe(true);
		// Only the first two matches are materialized into the rewritten source.
		expect(result.rewrittenSource).toBe("b(1); b(2); a(3);\n");
	});

	it("reports parseErrors and sets rewrittenSource to undefined on overlapping edits", () => {
		// `foo(bar)` contains `bar`; replacing both with one rule produces
		// overlapping edits that apply_edits rejects. The changes are still
		// surfaced (for dryRun preview) but the source cannot be materialized.
		const result = astRewrite({
			source: "foo(bar)\n",
			lang: "js",
			rewrites: [{ pattern: "bar", rewrite: "baz" }, { pattern: "foo($X)", rewrite: "qux($X)" }],
			});
		expect(result.replacements).toBeGreaterThanOrEqual(2);
		expect(result.rewrittenSource).toBeUndefined();
		expect(result.parseErrors).toBeDefined();
		expect(result.parseErrors!.some((e) => e.includes("Overlap") || e.includes("materialize"))).toBe(true);
		expect(result.changes.length).toBeGreaterThanOrEqual(2);
	});

	it("skips rewriting a file whose syntax tree contains error nodes (mirrors upstream ast_edit_blocking)", () => {
		// Upstream `ast_edit_blocking` records the parse issue and `continue`s,
		// skipping the file entirely (no partial rewrite). The matched `foo(1)`
		// is NOT replaced; the source is returned unchanged with a parseError.
		const result = astRewrite({
			source: "foo(1);\nbar(\n",
			lang: "js",
			rewrites: [{ pattern: "foo($X)", rewrite: "baz($X)" }],
		});
		expect(result.replacements).toBe(0);
		expect(result.changes).toHaveLength(0);
		expect(result.rewrittenSource).toBe("foo(1);\nbar(\n");
		expect(result.parseErrors).toBeDefined();
		expect(result.parseErrors![0]).toContain("parse error");
	});

	it("collects pattern-compile errors in parseErrors without throwing", () => {
		const result = astRewrite({
			source: "x\n",
			lang: "js",
			rewrites: [{ pattern: "a; b;", rewrite: "c" }],
		});
		expect(result.parseErrors).toBeDefined();
		expect(result.parseErrors![0]).toContain("Invalid pattern");
		expect(result.replacements).toBe(0);
	});

	it("rewrites Rust code with the rust grammar", () => {
		const result = astRewrite({
			source: "fn old() { }\n",
			lang: "rust",
			rewrites: [{ pattern: "fn $NAME($$$ARGS) $$$BODY", rewrite: "fn new_name($$$ARGS) $$$BODY" }],
		});
		expect(result.replacements).toBe(1);
		expect(result.rewrittenSource).toContain("fn new_name()");
	});

	it("throws when lang is empty", () => {
		expect(() =>
			astRewrite({ source: "x", lang: "  ", rewrites: [{ pattern: "x", rewrite: "y" }] }),
		).toThrow(/lang/);
	});

	it("throws when rewrites is empty", () => {
		expect(() => astRewrite({ source: "x", lang: "js", rewrites: [] })).toThrow(/rewrites/);
	});
});

describe("native resolveLanguage", () => {
	it("resolves Makefile via the special-filename path", () => {
		expect(resolveLanguage("foo/Makefile")).toBe("make");
		expect(resolveLanguage("/abs/path/makefile")).toBe("make");
		expect(resolveLanguage("GNUmakefile")).toBe("make");
	});

	it("resolves by extension", () => {
		expect(resolveLanguage("src/foo.ts")).toBe("typescript");
		expect(resolveLanguage("foo.tsx")).toBe("tsx");
		expect(resolveLanguage("foo.js")).toBe("javascript");
		expect(resolveLanguage("foo.py")).toBe("python");
		expect(resolveLanguage("foo.rs")).toBe("rust");
		expect(resolveLanguage("foo.go")).toBe("go");
		expect(resolveLanguage("foo.sh")).toBe("bash");
		expect(resolveLanguage("foo.mk")).toBe("make");
	});

	it("resolves shell rc files (dotfile, no extension)", () => {
		expect(resolveLanguage(".bashrc")).toBe("bash");
		expect(resolveLanguage(".zshrc")).toBe("bash");
		expect(resolveLanguage("profile")).toBe("bash");
	});

	it("resolves the full upstream Bash extension and rc-name set", () => {
		// Aligned with upstream `extensions(Bash)` + `from_extension` special names.
		for (const ext of ["cgi", "command", "env", "fcgi", "tmux", "tool"]) {
			expect(resolveLanguage(`foo.${ext}`)).toBe("bash");
		}
		expect(resolveLanguage(".zsh_aliases")).toBe("bash");
		expect(resolveLanguage(".bash_aliases")).toBe("bash");
		expect(resolveLanguage(".mkshrc")).toBe("bash");
	});

	it("resolves C / C++ / CMake by extension and special filename", () => {
		// `.h` resolves to C (not C++), per upstream `extensions(C)`.
		expect(resolveLanguage("src/foo.c")).toBe("c");
		expect(resolveLanguage("foo.h")).toBe("c");
		// C++ extension set, aligned with upstream `extensions(Cpp)`.
		for (const ext of ["cc", "cpp", "c++", "cxx", "hh", "hpp", "cu", "ino"]) {
			expect(resolveLanguage(`foo.${ext}`)).toBe("cpp");
		}
		// CMake: `.cmake` extension + the `CMakeLists.txt` special filename.
		expect(resolveLanguage("foo.cmake")).toBe("cmake");
		expect(resolveLanguage("CMakeLists.txt")).toBe("cmake");
		expect(resolveLanguage("subdir/CMakeLists.txt")).toBe("cmake");
	});

	it("resolves C / C++ / CMake by explicit alias", () => {
		expect(resolveLanguage("weird.path", "c")).toBe("c");
		expect(resolveLanguage("weird.path", "cpp")).toBe("cpp");
		expect(resolveLanguage("weird.path", "cmake")).toBe("cmake");
	});

	it("resolves by explicit alias override regardless of path", () => {
		expect(resolveLanguage("weird.path", "rust")).toBe("rust");
		expect(resolveLanguage("foo.txt", "ts")).toBe("typescript");
	});

	it("throws for an unrecognized extension without an override", () => {
		expect(() => resolveLanguage("foo.unknownext")).toThrow();
		expect(() => resolveLanguage("foo.txt")).toThrow();
	});

	it("throws for an unsupported explicit alias", () => {
		expect(() => resolveLanguage("foo.ts", "klingon")).toThrow(/Unsupported language/);
	});
});
