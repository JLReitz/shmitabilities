/**
 * Shared file-discovery + language-resolution helpers for the `ast_grep`
 * and `ast_edit` tools.
 *
 * Both tools scan candidate files the same way — `glob` under a root with
 * `node_modules`/`.git` default-ignored (unless the glob opts in), dotfiles
 * included, per-file language resolved via the native `resolveLanguage`
 * helper (which delegates to `pi-ast`'s special-filename + extension table).
 * Centralizing this here keeps the two tools' scan semantics in lockstep and
 * avoids drifting copies; `glob`/`minimatch` are runtime deps of *this
 * extension* (stock Pi's loader does not alias them).
 */
import { glob } from "glob";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolveLanguage } from "../native";

export const STRICTNESS_VALUES = [
	"cst",
	"smart",
	"ast",
	"relaxed",
	"signature",
	"template",
] as const;
export type Strictness = (typeof STRICTNESS_VALUES)[number];

export const STRICTNESS_SCHEMA_DESCRIPTION =
	"Pattern strictness; defaults to `smart`. One of: cst, smart, ast, relaxed, signature, template.";

/**
 * Discover candidate files. A file `path` scans just that file; a directory
 * globs under it. Hidden files ARE included (matching upstream
 * `include_hidden: true`); only `node_modules` and `.git` are default-ignored,
 * unless `glob` mentions `node_modules` (so a user can opt into scanning it).
 */
export async function discoverFiles(root: string, pattern: string | undefined): Promise<string[]> {
	const stats = await stat(root).catch(() => null);
	if (!stats) return [];
	if (stats.isFile()) return [root];
	if (!stats.isDirectory()) return [];

	const mentionsNodeModules = pattern !== undefined && pattern.includes("node_modules");
	const ignore = mentionsNodeModules ? ["**/.git/**"] : ["**/node_modules/**", "**/.git/**"];
	// `dot: true` includes dotfiles (.eslintrc.js, .bashrc, …) so they are
	// scanned unless an ignore rule excludes them. Upstream scans with
	// include_hidden: true; Phase 2 docs say only node_modules/.git are ignored.
	const found = await glob(pattern ?? "**/*", {
		cwd: root,
		nodir: true,
		ignore,
		dot: true,
	});
	return found.map((f) => resolve(root, f)).sort();
}

/** Resolve a file's language from its path; `null` if unsupported (skip). */
export function tryResolveLanguage(file: string): string | null {
	try {
		return resolveLanguage(file);
	} catch {
		return null;
	}
}

/** Display path: session-cwd-relative with forward slashes, else absolute. */
export function displayPath(file: string, cwd: string): string {
	const rel = relative(cwd, file);
	if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
		return rel.split(sep).join("/");
	}
	return file;
}

/** Validate a strictness string; throws on an unknown value (mirrors ast_grep). */
export function normalizeStrictness(value: unknown): Strictness | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value === "string" &&
		(STRICTNESS_VALUES as readonly string[]).includes(value)
	) {
		return value as Strictness;
	}
	throw new Error(
		`Invalid \`strictness\` '${value}'. One of: ${STRICTNESS_VALUES.join(", ")}.`,
	);
}
