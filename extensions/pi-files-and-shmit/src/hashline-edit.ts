/**
 * Hashline edit tool — content-hash-anchored edits via the vendored Patcher.
 *
 * Wraps {@link Patcher} + a shared {@link Filesystem} + {@link SnapshotStore}
 * into a Pi tool. Tags are minted by the companion `hashline_read` tool and
 * validated by the patcher (with stale-tag recovery). Partial commit failures
 * are surfaced honestly — the patcher does not roll back, so the error
 * renderer names the three recovery categories (written / failed /
 * notAttempted) and explicitly warns when the failed section is an `MV`,
 * since a failed move may leave the source on disk.
 *
 * Error signaling: the Pi runtime marks a tool result as an error **only when
 * `execute()` throws** (`agent-loop.js` hardcodes `isError: false` on any
 * non-throwing return). So this tool rethrows `MismatchError` and partial-
 * commit failures (with the MV warning appended) rather than returning an
 * `isError` flag the runtime would ignore.
 */
import { Type } from "@sinclair/typebox";
import {
	computeFileHash,
	formatHashlineHeader,
	MismatchError,
	Patch,
	Patcher,
	type Filesystem,
	type PatchSection,
	type PreparedSection,
	type SnapshotStore,
} from "@oh-my-pi/hashline";
import type { WritethroughCallback, FileDiagnosticsResult } from "./vendor/lsp";

export interface HashlineEditDeps {
	fs: Filesystem;
	snapshots: SnapshotStore;
	/** Optional LSP diagnostics source. When injected and
	 * non-undefined for the session cwd, a diagnostics-ONLY writethrough
	 * (`enableFormat: false`) is run after a successful apply on every
	 * content-changing section (SWAP/DEL → `op: "create"|"update"` with no
	 * `moveDest`). `MV`/`REM` sections are skipped (source gone/renamed).
	 * Format stays OFF so the returned `[path#TAG]` headers stay valid. */
	diagnosticsSource?: HashlineDiagnosticsSource;
}

/** Narrow seam for the LSP diagnostics-only writethrough. The full
 * {@link WritethroughFactory} from `./lsp-writethrough` is structurally
 * compatible. */
export interface HashlineDiagnosticsSource {
	forHashlineEdit(cwd: string): Promise<WritethroughCallback | undefined>;
}

const FAILED_SECTION_RE = /^Failed to write (.*?): /;

export function createHashlineEdit(deps: HashlineEditDeps) {
	const { fs, snapshots, diagnosticsSource } = deps;
	return {
		name: "hashline_edit",
		label: "Hashline Edit",
		promptSnippet:
			"Apply content-hash-anchored edits (SWAP/DEL/MV/REM) verified against `hashline_read` tags",
		promptGuidelines: [
			"`hashline_edit` requires a fresh `hashline_read` of the target file first; the `[path#TAG]` header and line numbers must match the current on-disk content.",
			"Use `SWAP start.=end:` for targeted replacements, `DEL N` for single-line deletes, `MV dest` to move/rename a file, `REM` to delete it. Never fabricate tags — re-read if anything changed.",
			"Format-on-write is intentionally OFF for this tool (reformatting would invalidate content-hash tags); post-edit diagnostics are best-effort and never block the write.",
			"At most one `[path#TAG]` section per file path per `hashline_edit` call — batch multiple edits to the same file as multiple ops under a single header.",
		],
		description:
			"Apply content-hash-anchored edits to one or more files. " +
			"Prefer this over base `edit` for multi-file batches or when exact oldText matching is fragile " +
			"(whitespace/indentation drift). " +
			"Requires a `[path#TAG]` header from a prior `hashline_read` of each target; stale or fabricated " +
			"tags are rejected (re-read to refresh).\n\n" +
			"Syntax — one or more sections, each `[path#TAG]` followed by one or more ops:\n" +
			"- `SWAP start.=end:` then `+body` lines (replace lines start–end with body)\n" +
			"- `DEL N` (delete line N)\n" +
			"- `MV dest` (move/rename the file to dest)\n" +
			"- `REM` (delete the file)\n\n" +
			"Line numbers in every op refer to the original file as read — ops within a section " +
			"do not shift each other's anchors (edits apply bottom-up so earlier indices stay valid), " +
			"so multiple ops can be batched against one snapshot without re-numbering. " +
			"At most one section per file path per call; to apply multiple edits to the same file, " +
			"list multiple ops under a single `[path#TAG]` header.\n\n" +
			"Example — a SWAP and a DEL batched under one header:\n" +
			"[path#TAG]\n" +
			"SWAP 5.=8:\n" +
			"+new line 5\n" +
			"+new line 6\n" +
			"DEL 20\n\n" +
			"Body rows should be `+`-prefixed (`+TEXT`); `+` rows are taken literally with no read-output " +
			"prefix stripping. Bare rows are tolerated and auto-recovered when every bare row in the hunk " +
			"carries a uniform `N:` read-output prefix (a warning is emitted), but `+` is the safe form. " +
			"A bare `-` row is rejected as a unified-diff deletion marker; write `+-…` for a literal `-` line.\n\n" +
			"Set `dryRun: true` for a side-effect-free preview: tags are validated and edits applied in memory, " +
			"but nothing is written. No snapshot is recorded on the success path; a stale-tag mismatch mints a " +
			"recovery snapshot for the live content, same as a real apply's mismatch. The preview returns the " +
			"would-be new `[path#TAG]` per section and throws the same errors as a real apply (stale tag, " +
			"multi-section no-op, duplicate path) — a single-section no-op returns a `noop` preview, matching apply. " +
			"A clean preview means the same input will apply with the same result, barring an intervening write. " +
			"The follow-up apply is a normal call that re-validates the section tag (rejecting on full mismatch, " +
			"warning on head/tail drift), so no separate plan digest is needed.\n\n" +
			"Edits commit in order with no rollback; on partial failure the error names written/failed/notAttempted categories.",
		parameters: Type.Object({
			input: Type.String({ description: "Hashline patch text: one or more `[path#TAG]` sections with edit ops." }),
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"Side-effect-free preview: read + validate tags + apply in memory, but write nothing. No " +
						"snapshot is recorded on the success path; a stale-tag mismatch mints a recovery snapshot, " +
						"same as a real apply. Returns the would-be per-section result (new `[path#TAG]`, op, changed " +
						"line) marked as a preview. Stale tags, parse errors, duplicate-path sections, and a no-op " +
						"within a multi-section batch throw with the same errors as a real apply; a single-section " +
						"no-op returns a `noop` preview. The follow-up apply re-validates the section tag — no " +
						"separate plan digest is needed.",
				}),
			),
		}),

		async execute(
			_toolCallId: string,
			params: { input: string; dryRun?: boolean },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: { cwd: string },
		) {
			const patch = Patch.parse(params.input, { cwd: ctx.cwd });
			const patcher = new Patcher({ fs, snapshots, blockResolver: undefined });

			// dryRun: side-effect-free preview. Reads + validates tags + applies
			// in memory via Patcher.prepare, but writes nothing. No snapshot is
			// recorded on the success path; a stale-tag mismatch mints a recovery
			// snapshot (vendored #mismatchError, not suppressible from the wrapper).
			// Mirrors apply's structure: single-section fast path skips the no-op
			// throw (returns op:"noop"); multi-section rejects no-ops + duplicate
			// paths. The follow-up apply re-validates the tag — no plan digest.
			if (params.dryRun === true) {
				return previewPatch(patch, patcher);
			}

			let result;
			try {
				result = await patcher.apply(patch);
			} catch (err) {
				// MismatchError carries the full "Edit rejected: …" diagnostic in
				// its message; rethrow so the runtime surfaces it as an error.
				if (err instanceof MismatchError) throw err;
				if (err instanceof Error) {
					throw new Error(renderPartialFailure(err.message, patch.sections));
				}
				throw err;
			}

			// Post-apply diagnostics-only pass. Run only on
			// content-changing sections (create/update with no moveDest). MV/REM
			// are skipped (source gone/renamed). Format is OFF (enableFormat:false
			// on the writethrough) so the returned [path#TAG] headers stay valid —
			// formatting would invalidate the tags the tool just emitted. The pass
			// is best-effort: a thrown writethrough is swallowed per-section so a
			// flaky/missing LSP server never fails an edit that already landed.
			const diagBySection = await collectDiagnostics(
				result.sections,
				ctx.cwd,
				signal,
				diagnosticsSource,
			);

			const lines = result.sections.map((s, i) => {
				const header = formatHashlineHeader(s.path, s.fileHash);
				const detail =
					`${header}\n${s.op}: ${s.path}` +
					(s.firstChangedLine ? ` (changed at line ${s.firstChangedLine})` : "") +
					(s.moveDest ? ` -> ${s.moveDest}` : "");
				let line =
					s.warnings.length > 0 ? `${detail}\nwarnings: ${s.warnings.join("; ")}` : detail;
				const diag = diagBySection[i];
				if (diag) {
					line += `\ndiagnostics: ${diag.summary}`;
					if (diag.messages.length > 0) line += `\n${diag.messages.join("\n")}`;
				}
				return line;
			});
			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: undefined,
			};
		},
	};
}

/**
 * Render a patcher commit failure. The patcher's `apply()` has two commit
 * paths with different error envelopes:
 *   - multi-section: wraps the error as `Failed to write <path>: <msg>` plus
 *     written/notAttempted category lists.
 *   - single-section fast path: lets the raw `commit()` error through with no
 *     prefix.
 * Both paths can fail mid-`MV`, and `commit()` relocates the snapshot entry
 * *before* `fs.move()` for an MV — so either path can leave disk/snapshot
 * state ambiguous. This renderer appends the explicit MV warning in both
 * cases: by parsing the `Failed to write <path>:` prefix (multi-section), or
 * by falling back to the single section when there is exactly one (fast path).
 *
 * NOTE: the failed path is matched back to the parsed section's `path`. This
 * is robust on unix (paths do not contain `:`) and for the upstream message
 * format. A typed partial-commit error from the patcher would be cleaner, but
 * that requires forking `Patcher.apply()`, which is deliberately not built
 * (see DEFERRED.md #2).
 */
function renderPartialFailure(message: string, sections: readonly PatchSection[]): string {
	// Multi-section path: extract the failed path from the `Failed to write
	// <path>:` prefix the patcher wraps around multi-section commit errors.
	const match = FAILED_SECTION_RE.exec(message);
	const failed = match
		? sections.find((s) => s.path === match[1])
		: // Single-section fast path: no prefix; the only section is the failed one.
			sections.length === 1 ? sections[0] : undefined;
	if (failed?.fileOp?.kind === "move") {
		return (
			`${message}\n` +
			`WARNING: the failed section was an MV (${failed.path} -> ${failed.fileOp.dest}). ` +
			`The source may still exist on disk and must be checked manually before retrying.`
		);
	}
	return message;
}

/** Run the post-apply diagnostics-only pass over eligible sections.
 *
 * Eligible: `op` is `create` or `update` AND no `moveDest` (i.e. a SWAP/DEL
 * that changed on-disk content). `MV`/`REM`/`noop` are skipped — the source
 * is gone/renamed or unchanged. Returns an array aligned with `sections`
 * (undefined entries for skipped/failed sections). The writethrough is
 * best-effort: per-section try/catch so one flaky server never fails an edit
 * that already landed. */
async function collectDiagnostics(
	sections: readonly { op: string; moveDest?: string; canonicalPath: string; written: string }[],
	cwd: string,
	signal: AbortSignal | undefined,
	source: HashlineDiagnosticsSource | undefined,
): Promise<(FileDiagnosticsResult | undefined)[]> {
	const out: (FileDiagnosticsResult | undefined)[] = new Array(sections.length).fill(undefined);
	if (!source) return out;
	const writethrough = await source.forHashlineEdit(cwd);
	if (!writethrough) return out;
	await Promise.all(
		sections.map(async (s, i) => {
			if (s.op !== "create" && s.op !== "update") return;
			if (s.moveDest !== undefined) return; // MV — source gone/renamed
			try {
				out[i] = await writethrough(s.canonicalPath, s.written, signal);
			} catch {
				// Best-effort: a thrown writethrough must not fail a successful edit.
				out[i] = undefined;
			}
		}),
	);
	return out;
}

/** Side-effect-free preview of a patch. Mirrors `Patcher.apply`'s structure
 * exactly: a single-section fast path (prepare → format, no no-op throw, no
 * unique-path check — a no-op returns `op:"noop"`), and a multi-section path
 * (prepare-all → unique-canonical-path assertion → no-op rejection → format).
 * Stops short of `commit`: nothing is written.
 *
 * Snapshot side effects: `Patcher.prepare` is side-effect-free on SUCCESS, but
 * a stale-tag mismatch routes through `#mismatchError` → `#recordFullSnapshot`
 * → `SnapshotStore.record`, minting a recovery snapshot for the live content.
 * That is the patcher's own mismatch behavior (a real apply does the same), so
 * the preview has parity with apply — but it is NOT snapshot-side-effect-free
 * on the mismatch path. The wrapper cannot suppress it without patching the
 * upstream patcher; see AGENTS.md. The FILESYSTEM is never written on any path.
 *
 * Predicted tags come from `computeFileHash`, which is exactly what
 * `SnapshotStore.record` returns, so a subsequent real apply emits the same
 * `[path#TAG]` headers (barring an intervening write — the tag check catches
 * that). Why not `Patcher.preflight`? It validates but returns `void` and
 * discards prepared sections, so the predicted tags would be lost. `apply`
 * writes. `commit` writes + records. `prepare` is the only side-effect-free
 * primitive on success. The unique-canonical-path + no-op checks are replicated
 * here because their patcher counterparts (`assertUniqueCanonicalPaths`, the
 * `isNoop` loop in `apply`/`preflight`) are module-private; if upstream exposes
 * a public preview, prefer it (see AGENTS.md). */
async function previewPatch(
	patch: Patch,
	patcher: Patcher,
): Promise<{ content: { type: "text"; text: string }[]; details: undefined }> {
	// Single-section fast path: mirror Patcher.apply — no unique-path check,
	// no no-op rejection (commit returns op:"noop" for no-op content).
	if (patch.sections.length === 1) {
		const prepared = await patcher.prepare(patch.sections[0]);
		return { content: [{ type: "text" as const, text: formatPreviewSection(prepared) }], details: undefined };
	}
	const prepared: PreparedSection[] = [];
	for (const section of patch.sections) prepared.push(await patcher.prepare(section));
	assertUniquePreviewPaths(prepared);
	for (const entry of prepared) {
		if (entry.isNoop) {
			throw new Error(`Edits to ${entry.section.path} resulted in no changes being made.`);
		}
	}
	const lines = prepared.map(formatPreviewSection);
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details: undefined };
}

/** Replicates `assertUniqueCanonicalPaths` from `patcher.ts` (module-private,
 * not exported). Kept in lockstep; if the patcher's message changes, update
 * here too. */
function assertUniquePreviewPaths(prepared: readonly PreparedSection[]): void {
	const seen = new Map<string, string>();
	for (const entry of prepared) {
		const previous = seen.get(entry.canonicalPath);
		if (previous !== undefined) {
			throw new Error(
				`Multiple hashline sections resolve to the same file (${previous} and ${entry.section.path}). Merge their ops under one header before applying.`,
			);
		}
		seen.set(entry.canonicalPath, entry.section.path);
	}
}

/** Format a prepared section as a preview block: the would-be new `[path#TAG]`
 * header, the op, the first changed line, and the move dest. Mirrors
 * `Patcher.commit`'s per-branch tag/op logic but computes the tag via
 * `computeFileHash` (what `SnapshotStore.record` returns) instead of
 * recording. */
function formatPreviewSection(p: PreparedSection): string {
	const { section, exists, normalized, applyResult, parseWarnings, fileOp } = p;
	const after = applyResult.text;
	const warnings = [...parseWarnings, ...(applyResult.warnings ?? [])];
	const moveDest = fileOp?.kind === "move" ? fileOp.dest : undefined;
	const displayPath = moveDest ?? section.path;

	// No-op: mirror Patcher.commit's noop branch (fileOp undefined, after ===
	// normalized). commit returns op:"noop" with the normalized content's hash.
	if (p.isNoop) {
		const hash = computeFileHash(normalized);
		const header = formatHashlineHeader(section.path, hash);
		const detail = `${header} (preview — not written)\nnoop: ${displayPath}`;
		return warnings.length > 0 ? `${detail}\nwarnings: ${warnings.join("; ")}` : detail;
	}

	const op =
		fileOp?.kind === "rem" ? "delete" : moveDest !== undefined ? "update" : exists ? "update" : "create";
	const fileHash = fileOp?.kind === "rem" ? computeFileHash(normalized) : computeFileHash(after);
	const header = formatHashlineHeader(displayPath, fileHash);
	const firstChangedLine = fileOp?.kind === "rem" ? undefined : applyResult.firstChangedLine;

	const detail =
		`${header} (preview — not written)\n${op}: ${displayPath}` +
		(firstChangedLine ? ` (changed at line ${firstChangedLine})` : "") +
		(moveDest ? ` -> ${moveDest}` : "");
	return warnings.length > 0 ? `${detail}\nwarnings: ${warnings.join("; ")}` : detail;
}
