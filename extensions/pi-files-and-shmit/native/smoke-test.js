#!/usr/bin/env node
/**
 * postinstall smoke test for the native ast-grep addon.
 *
 * `napi build` regenerates `native/index.js` + `native/index.d.ts` from the
 * `#[napi]` annotations. If the Rust build silently failed (e.g. a missing
 * `cargo`, a compile error swallowed by a noisy postinstall log), the JS
 * binding would be stale or absent and the extension would crash at startup
 * when `src/ast-grep.ts` imports it. This script imports the binding and
 * asserts the three exports exist *and* return a real result, failing the
 * install loudly otherwise.
 */
"use strict";

const path = require("node:path");
const { readFileSync, statSync } = require("node:fs");

let binding;
try {
	binding = require(path.join(__dirname, "index.js"));
} catch (err) {
	console.error("pi-files-and-shmit postinstall: failed to load native binding.");
	console.error("  Ensure `cargo` (Rust toolchain) is installed and on PATH.");
	console.error("  Underlying error:", err && err.message ? err.message : err);
	process.exit(1);
}

const { astMatch, astRewrite, resolveLanguage } = binding;
if (
	typeof astMatch !== "function" ||
	typeof astRewrite !== "function" ||
	typeof resolveLanguage !== "function"
) {
	console.error("pi-files-and-shmit postinstall: native binding is missing exports.");
	console.error("  Expected `astMatch`, `astRewrite`, and `resolveLanguage` functions; got:", Object.keys(binding));
	process.exit(1);
}

// Functional smoke: a real ast-grep match must return ≥1 result.
const result = astMatch({
	source: "console.log('x')",
	lang: "js",
	patterns: ["console.log($$$)"],
});
if (!result || !Array.isArray(result.matches) || result.matches.length < 1) {
	console.error("pi-files-and-shmit postinstall: astMatch returned no matches for a known pattern.");
	console.error("  Result:", JSON.stringify(result));
	process.exit(1);
}

const lang = resolveLanguage("foo/Makefile");
if (lang !== "make") {
	console.error(`pi-files-and-shmit postinstall: resolveLanguage('foo/Makefile') returned '${lang}', expected 'make'.`);
	process.exit(1);
}

// Functional smoke: a real ast-grep rewrite must substitute meta-variables
// and materialize the rewritten source.
const rewrite = astRewrite({
	source: "console.log('x');",
	lang: "js",
	rewrites: [{ pattern: "console.log($$$ARGS)", rewrite: "log($$$ARGS)" }],
});
if (!rewrite || rewrite.replacements !== 1 || rewrite.rewrittenSource !== "log('x');") {
	console.error("pi-files-and-shmit postinstall: astRewrite did not rewrite a known pattern.");
	console.error("  Result:", JSON.stringify(rewrite));
	process.exit(1);
}

// Verify the generated type definitions are present and declare both exports.
// Catches a stale/empty index.d.ts even when the .js binding loads fine.
const dtsPath = path.join(__dirname, "index.d.ts");
let dts;
try {
	const st = statSync(dtsPath);
	if (!st.isFile() || st.size === 0) {
		throw new Error(`index.d.ts is missing or empty (size=${st.size})`);
	}
	dts = readFileSync(dtsPath, "utf-8");
} catch (err) {
	console.error(`pi-files-and-shmit postinstall: native type defs failed check: ${err.message}`);
	process.exit(1);
}
if (!dts.includes("astMatch") || !dts.includes("astRewrite") || !dts.includes("resolveLanguage")) {
	console.error("pi-files-and-shmit postinstall: index.d.ts does not declare astMatch/astRewrite/resolveLanguage.");
	process.exit(1);
}

console.error("pi-files-and-shmit postinstall: native pi_ast module OK (astMatch + astRewrite + resolveLanguage verified).");
