/**
 * LSP settings resolution for the pi-files-and-shmit extension.
 *
 * Stock Pi's extension API exposes `ExtensionContext.cwd` but **no**
 * `session.settings` (the upstream LSP subsystem reads
 * `session.settings.get("lsp.formatOnWrite" | …)` and `session.enableLsp`).
 * Those are unavailable to a stock-Pi extension, so this module owns a small
 * file-only settings surface (no environment variables — behavior is
 * reproducible from the repo + user home, not dependent on the launching
 * shell).
 *
 * Resolution order (first source that defines a field wins):
 *   1. Project config `<cwd>/.pi/shmit.json`  → `{ lsp?: { ... } }`
 *   2. User config    `~/.pi/shmit.json`       → same shape
 *   3. Defaults (below)
 *
 * Config is JSON-only (YAML is intentionally not supported — avoids a `yaml`
 * runtime dep). The `lsp` key is namespaced under a top-level object so future
 * extension settings can coexist in the same file. Malformed JSON / non-object
 * `lsp` / non-boolean field values are ignored (the lower-priority source
 * fills in), so a broken user config never hard-fails a tool call.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LspSettings {
	/** Master switch. `false` disables LSP entirely (writethrough becomes noop). */
	enabled: boolean;
	/** Format-on-write via `textDocument/formatting`. Default OFF — formatting
	 * would invalidate the content-hash tags `hashline_edit` returns, so it is
	 * only safe for `ast_edit` (summary, not tags). */
	formatOnWrite: boolean;
	/** Collect diagnostics after a write and append to the tool result. */
	diagnosticsOnWrite: boolean;
	/** Enable the diagnostics ledger reduce (dedup across runs). */
	deduplicate: boolean;
}

export const DEFAULT_LSP_SETTINGS: LspSettings = {
	enabled: true,
	formatOnWrite: false,
	diagnosticsOnWrite: true,
	deduplicate: false,
};

/** Shape of the `shmit.json` file (only the fields this extension reads). */
interface ShmitConfigFile {
	lsp?: Partial<LspSettings>;
}

/**
 * Resolve LSP settings for a given project + user home.
 *
 * @param cwd     the session cwd (project root).
 * @param homeDir the user home directory (`os.homedir()`).
 */
export async function resolveLspSettings(
	cwd: string,
	homeDir: string,
): Promise<LspSettings> {
	const project = await readLspConfig(join(cwd, ".pi", "shmit.json"));
	const user = await readLspConfig(join(homeDir, ".pi", "shmit.json"));
	return {
		enabled: pickBoolean(project?.enabled, user?.enabled, DEFAULT_LSP_SETTINGS.enabled),
		formatOnWrite: pickBoolean(
			project?.formatOnWrite,
			user?.formatOnWrite,
			DEFAULT_LSP_SETTINGS.formatOnWrite,
		),
		diagnosticsOnWrite: pickBoolean(
			project?.diagnosticsOnWrite,
			user?.diagnosticsOnWrite,
			DEFAULT_LSP_SETTINGS.diagnosticsOnWrite,
		),
		deduplicate: pickBoolean(
			project?.deduplicate,
			user?.deduplicate,
			DEFAULT_LSP_SETTINGS.deduplicate,
		),
	};
}

/** Read + parse a `shmit.json`, returning its `lsp` sub-object (or undefined). */
async function readLspConfig(
	filePath: string,
): Promise<Partial<LspSettings> | undefined> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch {
		return undefined; // missing file — lower-priority source fills in
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined; // malformed JSON — ignore, don't hard-fail
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	const lsp = (parsed as { lsp?: unknown }).lsp;
	if (!lsp || typeof lsp !== "object" || Array.isArray(lsp)) {
		return undefined;
	}
	// Keep only boolean fields; drop anything else so a typo can't flip a flag.
	const out: Partial<LspSettings> = {};
	const src = lsp as Record<string, unknown>;
	if (typeof src.enabled === "boolean") out.enabled = src.enabled;
	if (typeof src.formatOnWrite === "boolean") out.formatOnWrite = src.formatOnWrite;
	if (typeof src.diagnosticsOnWrite === "boolean")
		out.diagnosticsOnWrite = src.diagnosticsOnWrite;
	if (typeof src.deduplicate === "boolean") out.deduplicate = src.deduplicate;
	return out;
}

/** First defined boolean wins; fall back to default. */
function pickBoolean(
	project: boolean | undefined,
	user: boolean | undefined,
	def: boolean,
): boolean {
	if (project !== undefined) return project;
	if (user !== undefined) return user;
	return def;
}
