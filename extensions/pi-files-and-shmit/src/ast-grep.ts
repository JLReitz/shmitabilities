/**
 * AST-grep search tool — TypeScript over the native `ast_match`.
 *
 * File discovery, globbing, candidate iteration, and result aggregation live
 * here (JS-side); the native crate only owns the
 * in-memory `ast_match` + `resolveLanguage` entry points. Each candidate
 * file's source is read with `node:fs/promises` and fed through `astMatch`.
 *
 * `glob` and `minimatch` are runtime deps of *this extension* — stock Pi's
 * loader (`loader.js:82`) aliases only Pi APIs and TypeBox modules, not these,
 * so they must ship in the extension's own `node_modules`.
 *
 * Paging: the native call is asked for *all* matches per file (limit = u32
 * max, offset = 0); this tool sorts and pages globally so `limit`/`offset`
 * behave across files, matching upstream `ast_grep` semantics.
 *
 * Error signaling: throws on bad input (invalid `lang`, invalid `strictness`,
 * empty `patterns`) per the extension convention (the Pi runtime only treats
 * a thrown `execute` as an error; `isError` flags are ignored). Per-file
 * parse/read errors are collected into `parseErrors` and do not fail the run.
 */
import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { astMatch, resolveLanguage } from "../native";
import type { AstFindMatch } from "../native";
import {
	STRICTNESS_SCHEMA_DESCRIPTION,
	STRICTNESS_VALUES,
	discoverFiles,
	displayPath,
	normalizeStrictness,
	tryResolveLanguage,
	type Strictness,
} from "./scan-utils";

/** Default match cap when the caller omits `limit` (mirrors native default). */
const DEFAULT_FIND_LIMIT = 50;

/**
 * Ask native for *all* matches per file so global paging happens in JS. u32
 * max is the largest cap `astMatch` accepts; real per-file counts are tiny in
 * interactive use.
 */
const NATIVE_LIMIT_ALL = 0xffffffff;

const STRICTNESS_SCHEMA = Type.Optional(
	Type.Union(
		[
			Type.Literal("cst"),
			Type.Literal("smart"),
			Type.Literal("ast"),
			Type.Literal("relaxed"),
			Type.Literal("signature"),
			Type.Literal("template"),
		],
		{ description: STRICTNESS_SCHEMA_DESCRIPTION },
	),
);

export function createAstGrep() {
	return {
		name: "ast_grep",
		label: "AST-Grep Search",
		promptSnippet:
			"Structural (AST) code search using ast-grep patterns; captures meta-variables across files",
		promptGuidelines: [
			"Use `ast_grep` instead of text regex when structure matters (call sites, statement shapes, matched delimiters) — `$VAR` captures a single node, `$$$MULTI` captures zero-or-more.",
			"Language is inferred per file from extension/special filename; override with `lang` only for unrecognized files.",
			"`node_modules` and `.git` are ignored by default unless `glob` mentions `node_modules`.",
		],
		description:
			"Structural (AST) search across files using ast-grep patterns. " +
			"Use for code search where regex/text matching is too loose (find call sites, " +
			"match statement shapes, capture meta-variables).\n\n" +
			"Patterns use ast-grep syntax: `console.log($$$ARGS)` matches any `console.log` call " +
			"and captures args; `$VAR` captures a single node, `$$$MULTI` captures zero-or-more. " +
			"Language is inferred per file from extension/special filenames (Makefile, shell rc " +
			"files, …), or overridden by `lang`.\n\n" +
			"Returns a JSON object: `{ matches, totalMatches, filesWithMatches, filesSearched, " +
			"limitReached, parseErrors? }`. Each match has path/text/byte range/1-based line+column.",
		parameters: Type.Object({
			patterns: Type.Array(Type.String(), {
				description: "ast-grep patterns to search for (OR across patterns). Required, non-empty.",
			}),
			path: Type.Optional(
				Type.String({
					description: "Single file or directory to scan. Defaults to the session cwd.",
				}),
			),
			glob: Type.Optional(
				Type.String({
					description:
						"Optional glob filter relative to `path` (e.g. `**/*.ts`). " +
						"`node_modules` and `.git` are ignored by default unless `glob` mentions `node_modules`.",
				}),
			),
			lang: Type.Optional(
				Type.String({
					description:
						"Language override (e.g. `ts`, `tsx`, `rust`, `python`, `go`, `bash`, `make`). " +
						"When set, every matched file is parsed as this language regardless of extension. " +
						"Required when scanning files with unrecognized extensions.",
				}),
			),
			selector: Type.Optional(
				Type.String({ description: "Rule selector for contextual pattern matching." }),
			),
			strictness: STRICTNESS_SCHEMA,
			limit: Type.Optional(
				Type.Number({
					description:
						"Max matches to return after `offset`. Must be a positive integer. Default 50.",
				}),
			),
			offset: Type.Optional(
				Type.Number({
					description:
						"Leading matches to skip before applying `limit`. Must be a non-negative integer. Default 0.",
				}),
			),
			includeMeta: Type.Optional(
				Type.Boolean({
					description: "When true, include captured meta-variable bindings per match.",
				}),
			),
			timeoutMs: Type.Optional(
				Type.Number({
					description:
						"Advisory wall-clock timeout in ms. NOTE: the native match is synchronous and " +
						"cannot be interrupted mid-scan; this is currently accepted but not enforced.",
				}),
			),
		}),

		async execute(
			_toolCallId: string,
			params: AstGrepParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd: string },
		) {
			if (!Array.isArray(params.patterns) || params.patterns.length === 0) {
				throw new Error("`patterns` is required and must include at least one non-empty pattern");
			}
			const trimmedPatterns = params.patterns.map((p) => p.trim()).filter((p) => p.length > 0);
			if (trimmedPatterns.length === 0) {
				throw new Error("`patterns` is required and must include at least one non-empty pattern");
			}
			const strictness = normalizeStrictness(params.strictness);

			const cwd = ctx.cwd;
			const root = params.path
				? isAbsolute(params.path) ? params.path : resolve(cwd, params.path)
				: cwd;

			// Validate an explicit `lang` once so a bad alias fails the call loudly
			// rather than silently skipping every candidate file.
			const explicitLang =
				params.lang && params.lang.trim().length > 0
					? resolveLanguage("placeholder", params.lang)
					: undefined;

			const files = await discoverFiles(root, params.glob);
			const limit = normalizeLimit(params.limit);
			const offset = normalizeOffset(params.offset);

			const matches: AstFindMatch[] = [];
			let filesWithMatches = 0;
			let filesSearched = 0;
			const parseErrors: string[] = [];

			for (const file of files) {
				filesSearched++;
				const display = displayPath(file, cwd);
				const langName = explicitLang ?? tryResolveLanguage(file);
				if (langName === null) continue; // unsupported extension and no override

				let source: string;
				try {
					source = await readFile(file, "utf-8");
				} catch (err) {
					parseErrors.push(`${display}: read error: ${(err as Error).message}`);
					continue;
				}
				let result;
				try {
					result = astMatch({
						source,
						lang: langName,
						patterns: trimmedPatterns,
						selector: params.selector,
						strictness: strictness,
						limit: NATIVE_LIMIT_ALL,
						offset: 0,
						includeMeta: params.includeMeta,
					});
				} catch (err) {
					parseErrors.push(`${display}: ${(err as Error).message}`);
					continue;
				}
				if (result.parseErrors) {
					for (const e of result.parseErrors) parseErrors.push(`${display}: ${e}`);
				}
				for (const m of result.matches) {
					m.path = display;
					matches.push(m);
				}
				if (result.matches.length > 0) filesWithMatches++;
			}

			matches.sort(compareMatches);
			const totalMatches = matches.length;
			const visible = matches.slice(offset);
			const limitReached = visible.length > limit;
			const paged = visible.slice(0, limit);

			const result = {
				matches: paged,
				totalMatches,
				filesWithMatches,
				filesSearched,
				limitReached,
				parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
			};
			return {
				content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
				details: undefined,
			};
		},
	};
}

interface AstGrepParams {
	patterns: string[];
	path?: string;
	glob?: string;
	lang?: string;
	selector?: string;
	strictness?: Strictness;
	limit?: number;
	offset?: number;
	includeMeta?: boolean;
	timeoutMs?: number;
}

/** Normalize `limit` like upstream: default when omitted, clamped to ≥1.
 * Rejects non-finite / non-integer / negative values loudly rather than
 * silently returning zero matches or dropping the tail (Array.slice(0,0)
 * or Array.slice(0,-n) would otherwise misbehave). */
function normalizeLimit(value: number | undefined): number {
	if (value === undefined) return DEFAULT_FIND_LIMIT;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error(`\`limit\` must be a positive integer; got ${value}`);
	}
	if (value < 1) throw new Error(`\`limit\` must be ≥ 1; got ${value}`);
	return value;
}

/** Normalize `offset`: default 0, must be a non-negative integer. */
function normalizeOffset(value: number | undefined): number {
	if (value === undefined) return 0;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error(`\`offset\` must be a non-negative integer; got ${value}`);
	}
	if (value < 0) throw new Error(`\`offset\` must be ≥ 0; got ${value}`);
	return value;
}

function compareMatches(a: AstFindMatch, b: AstFindMatch): number {
	return (
		a.path.localeCompare(b.path) ||
		a.startLine - b.startLine ||
		a.startColumn - b.startColumn ||
		a.endLine - b.endLine ||
		a.endColumn - b.endColumn ||
		a.byteStart - b.byteStart ||
		a.byteEnd - b.byteEnd
	);
}
