/**
 * Extension → LSP `languageId` map, trimmed to the 6 languages the vendored
 * LSP server catalog ships (TS/JS, Bash, Python, Rust, Go, C/C++). Replaces
 * upstream's `../utils/lang-from-path` `detectLanguageId`, which covers ~60
 * languages; we only need the ones with a server in `defaults.json`.
 *
 * The LSP `languageId` (second tuple element) is what `textDocument/didOpen`
 * sends; it differs from the ast crate's `SupportLang` aliases (e.g. `.tsx` →
 * ast `tsx` but LSP `typescriptreact`), so this map is kept separate from
 * `resolveLanguage` rather than routing through the native crate.
 */
import path from "node:path";

const EXTENSION_LANG: Record<string, string> = {
	// TypeScript / JavaScript
	ts: "typescript",
	cts: "typescript",
	mts: "typescript",
	tsx: "typescriptreact",
	js: "javascript",
	jsx: "javascriptreact",
	mjs: "javascript",
	cjs: "javascript",
	// Bash
	sh: "shellscript",
	bash: "shellscript",
	zsh: "shellscript",
	ksh: "shellscript",
	bats: "shellscript",
	// Python
	py: "python",
	pyi: "python",
	// Rust
	rs: "rust",
	// Go
	go: "go",
	// C / C++
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hh: "cpp",
	hpp: "cpp",
	hxx: "cpp",
};

/** Lowercased extension (without dot) used as the map key. */
function lspExtensionKey(filePath: string): string {
	const base = path.basename(filePath);
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return "";
	return base.slice(dot + 1).toLowerCase();
}

export function detectLanguageId(filePath: string): string {
	return EXTENSION_LANG[lspExtensionKey(filePath)] ?? "plaintext";
}
