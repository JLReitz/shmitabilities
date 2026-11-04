/**
 * Writethrough factory for the LSP wiring.
 *
 * Stock Pi exposes `ExtensionContext.cwd` but no `session.settings`, so the
 * behavioral flags (`lsp.enabled` / `formatOnWrite` / `diagnosticsOnWrite`)
 * come from {@link resolveLspSettings} (file-only `shmit.json` resolution).
 * The server catalog itself is read by the vendored `config.ts` from the same
 * file's `lsp.servers` key — the two readers do not overlap (flags vs.
 * servers), so they coexist cleanly.
 *
 * Two consumers, two policies:
 *
 *   - `ast_edit` returns a summary, not content-hash tags, so it can use the
 *     FULL writethrough (`enableFormat: formatOnWrite`, `enableDiagnostics:
 *     diagnosticsOnWrite`). If the LSP reformats, the formatted content lands
 *     on disk and the summary reflects it — no tagging tension.
 *   - `hashline_edit` returns `[path#TAG]` headers computed from the
 *     post-edit content. Format-on-write would invalidate those tags, so it
 *     uses a diagnostics-ONLY writethrough (`enableFormat: false`). The pass
 *     re-syncs the on-disk content, sends `didSave`, and collects diagnostics
 *     without reformatting.
 *
 * Both honor `lsp.enabled: false`: `forAstEdit` falls back to
 * {@link writethroughNoop} (which just writes), and `forHashlineEdit` returns
 * `undefined` so the tool skips the pass entirely. Settings are cached per
 * `cwd` (the file read is cheap but there is no reason to repeat it per
 * tool call within a session).
 */
import { homedir } from "node:os";
import {
	createLspWritethrough,
	writethroughNoop,
	type WritethroughCallback,
} from "./vendor/lsp";
import { resolveLspSettings, type LspSettings } from "./lsp-settings";

export type { WritethroughCallback } from "./vendor/lsp";

/** Builds per-cwd writethrough callbacks from resolved LSP settings. Injected
 * into `createAstEdit` (full writethrough) and `createHashlineEdit`
 * (diagnostics-only). */
export interface WritethroughFactory {
	/** Full writethrough for `ast_edit` (format + diagnostics per settings).
	 * Never `undefined` — falls back to {@link writethroughNoop} when LSP is
	 * disabled, so `ast_edit`'s apply path always has a writer. */
	forAstEdit(cwd: string): Promise<WritethroughCallback>;
	/** Diagnostics-only writethrough for `hashline_edit` (`enableFormat: false`
	 * so returned content-hash tags stay valid). `undefined` when LSP or
	 * diagnostics-on-write is disabled — the tool then skips the pass. */
	forHashlineEdit(cwd: string): Promise<WritethroughCallback | undefined>;
}

/**
 * Construct a {@link WritethroughFactory}. `resolveSettings` is injectable for
 * unit tests; production passes the default that reads `shmit.json` from the
 * project + user home.
 */
export function createWritethroughFactory(
	resolveSettings: (cwd: string) => Promise<LspSettings> = (cwd) =>
		resolveLspSettings(cwd, homedir()),
): WritethroughFactory {
	const cache = new Map<string, LspSettings>();
	const get = async (cwd: string): Promise<LspSettings> => {
		let s = cache.get(cwd);
		if (!s) {
			s = await resolveSettings(cwd);
			cache.set(cwd, s);
		}
		return s;
	};
	return {
		async forAstEdit(cwd: string): Promise<WritethroughCallback> {
			const s = await get(cwd);
			if (!s.enabled) return writethroughNoop;
			return createLspWritethrough(cwd, {
				enableFormat: s.formatOnWrite,
				enableDiagnostics: s.diagnosticsOnWrite,
			});
		},
		async forHashlineEdit(cwd: string): Promise<WritethroughCallback | undefined> {
			const s = await get(cwd);
			if (!s.enabled || !s.diagnosticsOnWrite) return undefined;
			// enableFormat is deliberately false: hashline_edit returns
			// content-hash tags that formatting would invalidate.
			return createLspWritethrough(cwd, {
				enableFormat: false,
				enableDiagnostics: true,
			});
		},
	};
}
