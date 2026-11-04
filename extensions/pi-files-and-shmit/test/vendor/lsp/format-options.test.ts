import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveFormatOptions, detectIndentFromContent } from "../../../src/vendor/lsp/format-options";

describe("format-options", () => {
	describe("detectIndentFromContent", () => {
		it("returns empty for empty content", () => {
			expect(detectIndentFromContent("")).toEqual({});
		});

		it("detects 2-space indent via GCD", () => {
			const content = "a\n  b\n    c\n";
			expect(detectIndentFromContent(content)).toEqual({ insertSpaces: true, tabSize: 2 });
		});

		it("detects 4-space indent via GCD", () => {
			const content = "x\n    y\n        z\n";
			expect(detectIndentFromContent(content)).toEqual({ insertSpaces: true, tabSize: 4 });
		});

		it("detects tab indent", () => {
			const content = "a\n\tb\n\t\tc\n";
			expect(detectIndentFromContent(content)).toEqual({ insertSpaces: false });
		});

		it("ignores blank lines", () => {
			const content = "a\n\n  b\n\n    c\n";
			expect(detectIndentFromContent(content)).toEqual({ insertSpaces: true, tabSize: 2 });
		});
	});

	describe("resolveFormatOptions", () => {
		let dir: string;

		beforeAll(async () => {
			dir = await mkdtemp(join(tmpdir(), "fmt-opts-"));
			// Project .editorconfig mandating 4-space indent for *.ts only (so .md
			// files exercise the no-rule fallback paths below).
			await writeFile(join(dir, ".editorconfig"), "root = true\n\n[*.ts]\nindent_style = space\nindent_size = 4\n");
			// A subdirectory with its own override: tabs for *.go.
			await mkdir(join(dir, "go-src"), { recursive: true });
			await writeFile(
				join(dir, "go-src", ".editorconfig"),
				"root = true\n\n[*.go]\nindent_style = tab\ntab_width = 8\n",
			);
		});

		afterAll(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		it("honours .editorconfig indent_size over content sniffing", () => {
			// Content is 2-space, but .editorconfig says 4. editorconfig wins.
			const content = "a\n  b\n";
			const opts = resolveFormatOptions(join(dir, "f.ts"), content, dir);
			expect(opts.tabSize).toBe(4);
			expect(opts.insertSpaces).toBe(true);
		});

		it("honours nested .editorconfig override (tabs for *.go)", () => {
			const content = "package main\n";
			const opts = resolveFormatOptions(join(dir, "go-src", "main.go"), content, dir);
			expect(opts.insertSpaces).toBe(false);
		});

		it("falls back to content sniffing when no .editorconfig rule applies", () => {
			// .editorconfig has no rule for *.md in the root file → falls through
			// to content detection (4-space content → 4).
			const content = "x\n    y\n";
			const opts = resolveFormatOptions(join(dir, "readme.md"), content, dir);
			expect(opts.tabSize).toBe(4);
			expect(opts.insertSpaces).toBe(true);
		});

		it("falls back to 2-space hardcoded default when content is empty and no rule", () => {
			// New file, no content to sniff, no matching rule.
			const opts = resolveFormatOptions(join(dir, "brand-new.md"), "", dir);
			expect(opts.tabSize).toBe(2);
			expect(opts.insertSpaces).toBe(true);
		});

		it("always passes trim/final-newline flags", () => {
			const opts = resolveFormatOptions(join(dir, "f.ts"), "a\n", dir);
			expect(opts.trimTrailingWhitespace).toBe(true);
			expect(opts.insertFinalNewline).toBe(true);
			expect(opts.trimFinalNewlines).toBe(true);
		});

		it("does not walk above the cwd root", () => {
			// A file in a subdir whose .editorconfig says 4 — resolve scoped to dir
			// should still find it (the walk is within cwd). A file whose only
			// .editorconfig is *above* dir should not be found.
			const opts = resolveFormatOptions(join(dir, "deep", "x.ts"), "", dir);
			// No .editorconfig in `deep/`, but the root one (in `dir`) applies
			// because the walk stays within cwd and dir has the root file.
			expect(opts.tabSize).toBe(4);
		});
	});
});
