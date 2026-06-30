/**
 * Tag-minting read tool — the producer side of the hashline snapshot store.
 *
 * Stock Pi's `read` tool emits plain text with no content-hash header, so the
 * model has no source for the `[path#TAG]` anchors `hashline_edit` requires.
 * This tool reads a file, records its normalized content in the shared
 * {@link SnapshotStore} (minting a tag), and returns a `[path#TAG]` header
 * followed by numbered lines the model can anchor edits against.
 *
 * Error signaling: the Pi runtime marks a tool result as an error **only when
 * `execute()` throws** (`agent-loop.js` hardcodes `isError: false` on any
 * non-throwing return and builds the error result from the thrown message).
 * So this tool throws `Error` for not-found and returns a plain success
 * result (`{ content, details }`) otherwise.
 *
 * TUI rendering: `execute()` always returns the full file body (the model
 * needs the whole file + the minted TAG regardless of display state). The
 * `renderCall`/`renderResult` pair mirrors stock Pi's `read` tool: when the
 * tool row is collapsed (not `expanded`), the call line is compact
 * (`hashline_read <path> (Ctrl+O to expand)`) and the result body is hidden
 * entirely, so a large read no longer floods the conversation transcript.
 * Expanding the row (Ctrl+O / `app.tools.expand`) renders the full
 * `[path#TAG]` header + numbered lines. Error results render regardless of
 * expansion (matching stock `read`'s `!expanded && !isError` gate).
 */
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { keyText } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	formatHashlineHeader,
	formatNumberedLines,
	isNotFound,
	normalizeToLF,
	stripBom,
	type Filesystem,
	type SnapshotStore,
} from "@oh-my-pi/hashline";

export interface HashlineReadDeps {
	fs: Filesystem;
	snapshots: SnapshotStore;
}

/**
 * Minimal slice of Pi's `ToolRenderContext` that this tool's renderers read.
 * `ToolRenderContext` is not re-exported from the public
 * `@earendil-works/pi-coding-agent` barrel, so this local supertype stands in
 * for it; under strict contravariance a narrower context param is assignable
 * to the slot Pi fills with the full context.
 */
interface HashlineRenderContext {
	/** Tool call arguments (may be partial during streaming). */
	args: { path?: string };
	/** Working directory for this tool execution. */
	cwd: string;
	/** Whether the result row is expanded. */
	expanded: boolean;
	/** Whether the current result is an error. */
	isError: boolean;
	/** Previously returned component for this render slot, if any. */
	lastComponent: Component | undefined;
}

/** Minimal result shape the renderer reads. */
interface HashlineRenderResult {
	content: Array<{ type: string; text?: string }>;
}

/** Minimal render-options shape the renderer reads. */
interface HashlineRenderOptions {
	expanded: boolean;
	isPartial: boolean;
}

/** Obtain a reusable {@link Text} component, recasting the prior slot if present.
 * Mirrors stock `read`'s `context.lastComponent ?? new Text(...)` then `setText` flow;
 * the cast is safe because this tool only ever returns `Text` from prior renders. */
function reuseText(context: HashlineRenderContext): Text {
	return (context.lastComponent ?? new Text("", 0, 0)) as Text;
}

/** Extract the text payload from a tool result (first `text` content block). */
function getResultText(result: HashlineRenderResult): string {
	const block = result.content.find((c) => c.type === "text");
	return block?.text ?? "";
}

/** Strip a leading path-segment colon prefix if present (defensive; noop for normal paths). */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function createHashlineRead(deps: HashlineReadDeps) {
	const { fs, snapshots } = deps;
	return {
		name: "hashline_read",
		label: "Hashline Read",
		promptSnippet:
			"Read a file with `[path#TAG]` hashline headers and numbered lines for precise edit anchoring",
		promptGuidelines: [
			"Use `hashline_read` (not `read`) when you intend to edit the file next — it mints content-hash tags that `hashline_edit` requires.",
			"TAGs are content-addressed; always re-read after a write before issuing the next edit (stale tags are rejected).",
			"Prefer `hashline_read` for large files you plan to edit; use base `read` for read-only inspection when no edit follows.",
		],
		description:
			"Read a file and emit a `[path#TAG]` hashline header plus `N:line` numbered lines. " +
			"Use this (not base `read`) whenever you intend to edit the file via `hashline_edit` — " +
			"the TAG it mints is required by `hashline_edit`. " +
			"For read-only inspection with no planned edit, base `read` is fine. " +
			"Paths resolve against the process working directory (the Pi session cwd).",
		parameters: Type.Object({
			path: Type.String({ description: "File path to read (relative to the working directory, or absolute)." }),
		}),

		async execute(
			_toolCallId: string,
			params: { path: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: { cwd: string },
		) {
			const { path } = params;
			let raw: string;
			try {
				raw = await fs.readText(path);
			} catch (err) {
				if (isNotFound(err)) {
					throw new Error(`File not found: ${path}`);
				}
				throw err;
			}
			// Match the patcher's canonicalization so the minted tag validates:
			// strip BOM, normalize to LF, then hash. The patcher repeats the same
			// normalization on the text it reads before comparing tags.
			const { text: noBom } = stripBom(raw);
			const normalized = normalizeToLF(noBom);
			const canonical = fs.canonicalPath(path);
			const lineCount = normalized.split("\n").length;
			const seenLines = new Set<number>();
			for (let i = 1; i <= lineCount; i++) seenLines.add(i);
			const tag = snapshots.record(canonical, normalized, seenLines);
			const header = formatHashlineHeader(path, tag);
			const body = formatNumberedLines(normalized);
			return {
				content: [{ type: "text" as const, text: `${header}\n${body}` }],
				details: undefined,
			};
		},

		renderCall(args: { path?: string }, theme: Theme, context: HashlineRenderContext): Component {
			const text = reuseText(context);
			const rawPath = args?.path;
			const pathDisplay = rawPath
				? theme.fg("accent", rawPath)
				: theme.fg("toolOutput", "...");
			const title = theme.fg("toolTitle", theme.bold("hashline_read"));
			// Collapsed rows show the expand affordance; expanded rows drop it
			// (the body is visible, so the hint is redundant). Mirrors stock
			// `read`'s compact-call-line behavior.
			const expandHint = context.expanded
				? ""
				: theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
			text.setText(`${title} ${pathDisplay}${expandHint}`);
			return text;
		},

		renderResult(
			result: HashlineRenderResult,
			options: HashlineRenderOptions,
			theme: Theme,
			context: HashlineRenderContext,
		): Component {
			const text = reuseText(context);
			// When collapsed and not an error, hide the body entirely so a full
			// file read does not flood the transcript. The model still receives
			// the complete content + TAG from `execute()` regardless of this
			// display state. Errors render in both states (stock `read` parity).
			if (!options.expanded && !context.isError) {
				text.setText("");
				return text;
			}
			const output = replaceTabs(getResultText(result).replace(/\r/g, ""));
			const lines = output.length > 0 ? output.split("\n") : [];
			// Expanded: show every line. Error (collapsed): cap at a 10-line
			// preview so a thrown message cannot flood the row either.
			const maxLines = options.expanded ? lines.length : 10;
			const displayLines = lines.slice(0, maxLines);
			const remaining = lines.length - maxLines;
			let body = displayLines.map((line) => theme.fg("toolOutput", line)).join("\n");
			if (body.length > 0) {
				body = `\n${body}`;
			}
			if (remaining > 0) {
				body +=
					theme.fg("muted", `\n... (${remaining} more lines, `) +
					theme.fg("dim", keyText("app.tools.expand")) +
					theme.fg("muted", ` to expand)`);
			}
			text.setText(body);
			return text;
		},
	};
}
