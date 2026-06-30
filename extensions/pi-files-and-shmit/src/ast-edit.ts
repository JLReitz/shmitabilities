/**
 * AST-edit tool — TypeScript over the native `ast_rewrite`.
 *
 * Stock Pi's extension API has no `deferrable`/resolve gate (that
 * machinery lives only in the oh-my-pi source monorepo), so this tool uses a
 * **`dryRun` two-call flow** instead of pinned prepared state:
 *
 *   1. `ast_edit({ ..., dryRun: true })`  — scans files, runs `astRewrite`
 *      per file, returns a per-file before/after diff plus a
 *      `previewHashes` map (path → content hash of each affected file's
 *      *original* content). Writes nothing.
 *   2. `ast_edit({ ..., dryRun: false, previewHashes })` — re-scans the same
 *      scope, re-checks each affected file's content hash against the
 *      preview, and only then writes. If any affected file changed between
 *      preview and apply (TOCTOU), the call fails with "files changed since
 *      preview" and writes nothing.
 *
 * The TOCTOU re-check is the honest tradeoff of `dryRun` vs. the unavailable
 * deferrable/resolve gate: the cost is one extra scan on apply, and the
 * safety is real (no stale plan is ever written).
 *
 * File discovery, globbing, and per-file language resolution are shared with
 * `ast_grep` via `./scan-utils` so the two tools' scan semantics stay in
 * lockstep. `glob`/`minimatch` are runtime deps of *this extension*.
 *
 * Error signaling: throws on bad input (invalid `lang`, invalid `strictness`,
 * empty `rewrites`, missing `previewHashes` on apply) per the extension
 * convention (the Pi runtime only treats a thrown `execute` as an error).
 * Per-file parse/rewrite errors are collected into `parseErrors` and do not
 * fail the run; a materialization failure (`rewrittenSource` undefined on a
 * file with replacements) fails the apply loudly rather than writing a
 * partial plan.
 */
import { Type } from "@sinclair/typebox";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { astRewrite, resolveLanguage } from "../native";
import type { AstRewriteChange } from "../native";
import { computeFileHash } from "@oh-my-pi/hashline";
import type { WritethroughCallback } from "./vendor/lsp";
import {
	STRICTNESS_SCHEMA_DESCRIPTION,
	discoverFiles,
	displayPath,
	normalizeStrictness,
	tryResolveLanguage,
	type Strictness,
} from "./scan-utils";

/** Per-match change record (native `AstRewriteChange` + the file's path). */
interface FileChange extends AstRewriteChange {
	path: string;
}

/** Per-file replacement count, mirroring upstream `AstReplaceFileChange`. */
interface FileChangeCount {
	path: string;
	count: number;
}

/** Result of a `ast_edit` run (dryRun or apply). Mirrors upstream
 * `AstReplaceResult` field names so the model sees a familiar surface. */
interface AstEditResult {
	changes: FileChange[];
	fileChanges: FileChangeCount[];
	totalReplacements: number;
	filesTouched: number;
	filesSearched: number;
	applied: boolean;
	limitReached: boolean;
	parseErrors?: string[];
	/** Present on `dryRun: true`: path → content hash of each affected file's
	 * original content. Pass this back on the apply call for the TOCTOU
	 * re-check. Absent on apply. */
	previewHashes?: Record<string, string>;
	/** Present on `dryRun: true`: digest of the normalized rewrite plan
	 * (rewrites + selector + strictness + lang + scope + limits). Pass this
	 * back on apply to prove the plan wasn't changed between preview and
	 * apply. Absent on apply. */
	planDigest?: string;
}

/** One file's rewrite outcome, kept around so the apply step can write it. */
interface FileRewrite {
	displayPath: string;
	/** Original source read from disk (preview time, or re-read on apply). */
	source: string;
	/** Materialized rewritten source; `null` when edits overlapped or
	 * materialization failed (apply treats this as a hard error). */
	rewrittenSource: string | null;
	changes: AstRewriteChange[];
	replacements: number;
	parseErrors: string[];
}

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

/** Narrow seam for the LSP writethrough. When injected,
 * `ast_edit`'s apply path routes each affected file's write through the
 * returned {@link WritethroughCallback} instead of `writeFile`, so the LSP
 * can sync the new content to its servers, optionally format it
 * (`enableFormat`), and collect diagnostics — the upstream `write`/`edit`
 * flow. `ast_edit` returns a summary (not content-hash tags), so formatting
 * is safe. When absent, apply writes directly to disk. The full
 * {@link WritethroughFactory} (from `./lsp-writethrough`) is structurally
 * compatible. */
export interface AstEditWritethroughSource {
	forAstEdit(cwd: string): Promise<WritethroughCallback>;
}

export function createAstEdit(options?: { writethroughSource?: AstEditWritethroughSource }) {
	const writethroughSource = options?.writethroughSource;
	return {
		name: "ast_edit",
		label: "AST-Edit",
		promptSnippet:
			"Structural (AST) rewrite across files via ast-grep patterns, with TOCTOU-safe dry-run preview",
		promptGuidelines: [
			"`ast_edit` is a two-phase tool: `dryRun: true` previews before/after per file (no writes); `dryRun: false` applies. Always preview structural rewrites before applying.",
			"The rewrite is TOCTOU-safe — content hashes from the preview must match at apply time or the call fails without writing.",
			"Use `ast_edit` (not `hashline_edit`) when the change is structural and pattern-driven; use `hashline_edit` for precise line-range replacements anchored on existing content.",
		],
		description:
			"Structural (AST) rewrite across files using ast-grep patterns. Preview " +
			"with `dryRun: true` first, then apply with `dryRun: false` passing back the " +
			"returned `previewHashes` AND `planDigest`.\n\n" +
			"`rewrites` is a pattern→template map (e.g. `{ \"console.log($$$ARGS)\": \"log($$$ARGS)\" }`). " +
			"The template may reference captured meta-variables (`$VAR`, `$$$MULTI`). Language is " +
			"inferred per file from extension/special filenames, or overridden by `lang`.\n\n" +
			"On `dryRun: true` returns per-match before/after changes, per-file counts, " +
			"`previewHashes` (content hashes of each affected file's original content), and a " +
			"`planDigest` (digest of the rewrite plan). Writes nothing. On `dryRun: false` " +
			"(requires `previewHashes` AND `planDigest` from the preview), re-scans, verifies the " +
			"`planDigest` matches (proving the plan wasn't swapped), re-checks each affected file's " +
			"hash, and writes only if nothing changed since the preview (TOCTOU-safe). If any affected " +
			"file changed or the plan digest mismatches, the call fails and writes nothing.",
		parameters: Type.Object({
			rewrites: Type.Record(Type.String(), Type.String(), {
				description:
					"Pattern→rewrite map. At least one non-empty pattern is required. " +
					"e.g. { \"foo($X)\": \"bar($X)\" }.",
			}),
			path: Type.Optional(
				Type.String({
					description: "Single file or directory to rewrite. Defaults to the session cwd.",
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
						"When set, every matched file is rewritten as this language regardless of extension. " +
						"Required when rewriting files with unrecognized extensions.",
				}),
			),
			selector: Type.Optional(
				Type.String({ description: "Rule selector for contextual pattern matching." }),
			),
			strictness: STRICTNESS_SCHEMA,
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"When true (default), compute changes and return a preview without writing. " +
						"When false, apply the rewrites (requires `previewHashes` from a prior preview).",
				}),
			),
			maxReplacements: Type.Optional(
				Type.Number({
					description:
						"Cap on total replacements across all files. Must be a positive integer. " +
						"Default: no cap.",
				}),
			),
			maxFiles: Type.Optional(
				Type.Number({
					description:
						"Cap on distinct files that may be modified. Must be a positive integer. " +
						"Default: no cap.",
				}),
			),
			previewHashes: Type.Optional(
				Type.Record(Type.String(), Type.String(), {
					description:
						"Required when `dryRun: false`: the `previewHashes` map returned by the prior " +
						"`dryRun: true` call. Used for the TOCTOU content-hash re-check.",
				}),
			),
			planDigest: Type.Optional(
				Type.String({
					description:
						"Required when `dryRun: false`: the `planDigest` returned by the prior " +
						"`dryRun: true` call. Proves the rewrite plan (patterns, selector, " +
						"strictness, lang, scope, limits) was not changed between preview and apply.",
				}),
			),
		}),

		async execute(
			_toolCallId: string,
			params: AstEditParams,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd: string },
		) {
			const rewrites = normalizeRewrites(params.rewrites);
			const strictness = normalizeStrictness(params.strictness);
			const dryRun = params.dryRun ?? true;
			const maxReplacements = normalizePositiveInt(params.maxReplacements, "maxReplacements", false);
			const maxFiles = normalizePositiveInt(params.maxFiles, "maxFiles", false);

			const cwd = ctx.cwd;
			const root = params.path
				? isAbsolute(params.path) ? params.path : resolve(cwd, params.path)
				: cwd;

			// Validate an explicit `lang` once so a bad alias fails the call loudly.
			const explicitLang =
				params.lang && params.lang.trim().length > 0
					? resolveLanguage("placeholder", params.lang)
					: undefined;

			if (!dryRun && params.previewHashes === undefined) {
				throw new Error(
					"`dryRun: false` requires `previewHashes` from a prior `dryRun: true` call; " +
						"re-run with `dryRun: true` first and pass the returned `previewHashes` back.",
				);
			}

			const files = await discoverFiles(root, params.glob);

			// Digest of the normalized rewrite plan. Computed identically on both
			// the preview and apply calls; any change to rewrites/selector/
			// strictness/lang/scope/limits invalidates the preview. Uses the resolved
			// root (not the raw `path` param) so `path:"src"` and `path:"."` that
			// resolve to the same root do not cause a false mismatch.
			const planDigest = computePlanDigest({
				rewrites,
				selector: params.selector,
				strictness,
				lang: explicitLang,
				root,
				glob: params.glob,
				maxReplacements,
				maxFiles,
			});

			// Scan + rewrite every candidate file with a shared global replacement
			// budget (mirrors upstream `ast_edit_blocking`'s max_replacements).
			const { rewrites: perFile, totalReplacements, filesTouched, limitReached, parseErrors } =
				await scanAndRewrite(files, cwd, explicitLang, rewrites, params.selector, strictness, {
					maxReplacements,
					maxFiles,
				});

			if (dryRun) {
				// Producer side: record the content hash of each affected file's
				// *original* content so the apply call can detect a TOCTOU change.
				const previewHashes: Record<string, string> = {};
				const changes: FileChange[] = [];
				const fileChanges: FileChangeCount[] = [];
				for (const fr of perFile) {
					if (fr.replacements === 0) continue;
					previewHashes[fr.displayPath] = computeFileHash(fr.source);
					fileChanges.push({ path: fr.displayPath, count: fr.replacements });
					for (const c of fr.changes) {
						changes.push({ ...c, path: fr.displayPath });
					}
				}
				const result: AstEditResult = {
					changes,
					fileChanges,
					totalReplacements,
					filesTouched,
					filesSearched: files.length,
					applied: false,
					limitReached,
					parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
					previewHashes,
					planDigest,
				};
				return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: undefined };
			}

			// dryRun === false: TOCTOU re-check, then write.
			const previewHashes = params.previewHashes!;

			// 0. The rewrite PLAN must match the preview exactly. `previewHashes`
			//    alone binds only file content, not the plan: without this check a
			//    caller could preview `foo($X)->bar($X)` then apply
			//    `foo($X)->baz($X)` against the same hashes, writing unpreviewed
			//    edits. The digest covers the normalized rewrites + selector +
			//    strictness + lang + scope + limits, so any plan change invalidates
			//    the preview.
			if (params.planDigest === undefined) {
				throw new Error(
					"`dryRun: false` requires `planDigest` from the prior `dryRun: true` call; " +
						"re-run with `dryRun: true` first and pass the returned `planDigest` back.",
				);
			}
			if (params.planDigest !== planDigest) {
				throw new Error(
					"Rewrite plan changed since preview (planDigest mismatch). " +
						"Re-run with `dryRun: true` and re-apply with the new `planDigest`.",
				);
			}
			const affectedNow = perFile.filter((fr) => fr.replacements > 0).map((fr) => fr.displayPath);
			const affectedPreview = Object.keys(previewHashes);

			// 1. The SET of affected files must match the preview. A file that had
			//    changes in preview but none now (or vice versa) means the content
			//    drifted — refuse to write a stale plan.
			const nowSet = new Set(affectedNow);
			const previewSet = new Set(affectedPreview);
			const setDiffers =
				nowSet.size !== previewSet.size ||
				[...nowSet].some((p) => !previewSet.has(p));
			if (setDiffers) {
				throw new Error(
					`Files changed since preview (set of affected files differs). ` +
						`Preview: [${affectedPreview.join(", ")}]. ` +
						`Now: [${affectedNow.join(", ")}]. Re-run with \`dryRun: true\`.`,
				);
			}

			// 2. Each affected file's content hash must match the preview. Re-read
			//    each affected file FRESH from disk right before the write phase
			//    (not the source captured during the scan) so the check covers the
			//    full window between preview and write — the scan read happens
			//    earlier in this call, and another process could change a file in
			//    between. Verifying all affected files before ANY write means a
			//    drifted file fails the whole apply with nothing written.
			const drifted: string[] = [];
			for (const fr of perFile) {
				if (fr.replacements === 0) continue;
				const abs = isAbsolute(fr.displayPath) ? fr.displayPath : resolve(cwd, fr.displayPath);
				let live: string;
				try {
					live = await readFile(abs, "utf-8");
				} catch (err) {
					throw new Error(
						`File changed since preview: ${fr.displayPath} (read failed: ${(err as Error).message}). ` +
							"Re-run with `dryRun: true`.",
					);
				}
				const current = computeFileHash(live);
				if (current !== previewHashes[fr.displayPath]) {
					drifted.push(fr.displayPath);
				}
			}
			if (drifted.length > 0) {
				throw new Error(
					`Files changed since preview: [${drifted.join(", ")}]. ` +
						"Re-run with `dryRun: true` and re-apply.",
				);
			}

			// 3. Materialization must have succeeded for every affected file.
			const unmaterialized = perFile.filter(
				(fr) => fr.replacements > 0 && fr.rewrittenSource === null,
			);
			if (unmaterialized.length > 0) {
				const detail = unmaterialized
					.map((fr) => `${fr.displayPath}: ${fr.parseErrors.join("; ")}`)
					.join("; ");
				throw new Error(
					`Could not materialize edits for ${unmaterialized.length} file(s); ` +
						`refusing to write a partial plan. ${detail}`,
				);
			}

			// 4. Write. Writes are sequential (mirrors upstream `ast_edit_blocking`'s
			//    pending-writes flush). This is NOT all-or-nothing across files: a
			//    write failure (ENOSPC, permissions, …) on a later file leaves earlier
			//    files already modified. True multi-file atomicity would require a
			//    staging journal + temp-file-then-rename-all, which is deliberately
			//    not built (same posture as the hashline edit tool and
			//    upstream ast_edit). The model is expected to re-read and reconcile
			//    any files that did not land. No-op writes (rewrite produced identical
			//    content) are skipped.
			//
			//    When a writethrough source is injected (LSP
			//    enabled), route each write through the resolved writethrough so the
			//    LSP can sync + (optionally) format + collect diagnostics. The
			//    writethrough owns the on-disk write; when disabled it is
			//    `writethroughNoop`, which writes the content directly — so the
			//    observable result matches the direct-write path. The TOCTOU check
			//    above already verified each affected file's pre-write content hash,
			//    so a formatted result diverging from the preview hash is expected and
			//    safe (ast_edit returns a summary, not tags).
			const writes: { displayPath: string; source: string; output: string }[] = [];
			const changes: FileChange[] = [];
			const fileChanges: FileChangeCount[] = [];
			for (const fr of perFile) {
				if (fr.replacements === 0) continue;
				const output = fr.rewrittenSource!;
				// Skip no-op writes (pattern matched but rewrite produced identical text).
				if (output !== fr.source) {
					writes.push({ displayPath: fr.displayPath, source: fr.source, output });
				}
				fileChanges.push({ path: fr.displayPath, count: fr.replacements });
				for (const c of fr.changes) {
					changes.push({ ...c, path: fr.displayPath });
				}
			}
			const writethrough = writethroughSource
				? await writethroughSource.forAstEdit(ctx.cwd)
				: undefined;
			for (const w of writes) {
				const abs = isAbsolute(w.displayPath) ? w.displayPath : resolve(cwd, w.displayPath);
				if (writethrough) {
					await writethrough(abs, w.output, signal);
				} else {
					await writeFile(abs, w.output, "utf-8");
				}
			}

			const result: AstEditResult = {
				changes,
				fileChanges,
				totalReplacements,
				filesTouched,
				filesSearched: files.length,
				applied: true,
				limitReached,
				parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
			};
			return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: undefined };
		},
	};
}

interface AstEditParams {
	rewrites?: Record<string, string>;
	path?: string;
	glob?: string;
	lang?: string;
	selector?: string;
	strictness?: string;
	dryRun?: boolean;
	maxReplacements?: number;
	maxFiles?: number;
	previewHashes?: Record<string, string>;
	planDigest?: string;
}

/** A rewrite rule after normalization: trimmed, non-empty, de-duplicated. */
interface RewriteRule {
	pattern: string;
	rewrite: string;
}

/** Normalize the `rewrites` map: trim keys, drop empty patterns, dedupe. */
function normalizeRewrites(raw: Record<string, string> | undefined): RewriteRule[] {
	const rules: RewriteRule[] = [];
	const seen = new Set<string>();
	for (const [pattern, rewrite] of Object.entries(raw ?? {})) {
		const trimmed = pattern.trim();
		if (trimmed.length === 0) continue;
		const key = `${trimmed}\u0000${rewrite}`;
		if (seen.has(key)) continue;
		seen.add(key);
		rules.push({ pattern: trimmed, rewrite });
	}
	if (rules.length === 0) {
		throw new Error("`rewrites` is required and must include at least one non-empty pattern");
	}
	return rules;
}

/** Inputs to the plan digest. Any change invalidates the preview. */
interface PlanDigestInput {
	rewrites: RewriteRule[];
	selector?: string;
	strictness?: Strictness;
	lang?: string;
	root: string;
	glob?: string;
	maxReplacements: number;
	maxFiles: number;
}

/** Compute a digest of the normalized rewrite plan. Applied identically on
 * `dryRun: true` (returned as `planDigest`) and `dryRun: false` (recomputed
 * and compared to the passed-in `planDigest`), so a caller cannot swap the
 * rewrite plan between preview and apply while reusing the same
 * `previewHashes`. Uses the same `computeFileHash` (sha1 low-16) as the
 * content-hash tags for consistency.
 *
 * Rule order is preserved (NOT sorted): the native `ast_rewrite` loop processes
 * `compiled_rules` in order and stops at `max_replacements`, so reordering the
 * rules can change which replacements land under a cap — the digest must
 * capture that. The resolved `root` is used (not the raw `path` param) so
 * different raw paths that resolve to the same root do not cause a false
 * mismatch. */
function computePlanDigest(input: PlanDigestInput): string {
	const canonical = JSON.stringify({
		// Preserve insertion order (Object.entries is insertion-ordered for string
		// keys); do NOT sort — rule order is plan-affecting under maxReplacements.
		r: input.rewrites.map((r) => [r.pattern, r.rewrite]),
		s: input.selector?.trim() || null,
		st: input.strictness ?? null,
		l: input.lang ?? null,
		p: input.root,
		g: input.glob ?? null,
		mr: Number.isFinite(input.maxReplacements) ? input.maxReplacements : null,
		mf: Number.isFinite(input.maxFiles) ? input.maxFiles : null,
	});
	return computeFileHash(canonical);
}

/** Validate a positive-integer option. `allowUndefined=true` means "no cap". */
function normalizePositiveInt(
	value: number | undefined,
	name: string,
	allowUndefined: boolean,
): number {
	if (value === undefined) return allowUndefined ? Infinity : Infinity;
	if (!Number.isFinite(value) || !Number.isInteger(value)) {
		throw new Error(`\`${name}\` must be a positive integer; got ${value}`);
	}
	if (value < 1) throw new Error(`\`${name}\` must be ≥ 1; got ${value}`);
	return value;
}

/** Scan every candidate file and run `astRewrite` with a shared global budget. */
async function scanAndRewrite(
	files: string[],
	cwd: string,
	explicitLang: string | undefined,
	rewrites: RewriteRule[],
	selector: string | undefined,
	strictness: Strictness | undefined,
	limits: { maxReplacements: number; maxFiles: number },
): Promise<{
	rewrites: FileRewrite[];
	totalReplacements: number;
	filesTouched: number;
	limitReached: boolean;
	parseErrors: string[];
}> {
	const rules = rewrites.map((r) => ({ pattern: r.pattern, rewrite: r.rewrite }));
	const perFile: FileRewrite[] = [];
	const parseErrors: string[] = [];
	let totalReplacements = 0;
	let filesTouched = 0;
	let limitReached = false;
	let budget = limits.maxReplacements;

	for (const file of files) {
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

		if (budget <= 0 || filesTouched >= limits.maxFiles) {
			limitReached = true;
			break;
		}

		let result;
		try {
			result = astRewrite({
				source,
				lang: langName,
				rewrites: rules,
				selector,
				strictness,
				maxReplacements: Number.isFinite(budget) ? budget : undefined,
			});
		} catch (err) {
			parseErrors.push(`${display}: ${(err as Error).message}`);
			continue;
		}
		if (result.parseErrors) {
			for (const e of result.parseErrors) parseErrors.push(`${display}: ${e}`);
		}

		perFile.push({
			displayPath: display,
			source,
			rewrittenSource: result.rewrittenSource ?? null,
			changes: result.changes,
			replacements: result.replacements,
			parseErrors: result.parseErrors ?? [],
		});

		if (result.replacements > 0) {
			filesTouched += 1;
			totalReplacements += result.replacements;
			budget -= result.replacements;
			if (result.limitReached) {
				limitReached = true;
				break;
			}
		}
	}

	return { rewrites: perFile, totalReplacements, filesTouched, limitReached, parseErrors };
}
