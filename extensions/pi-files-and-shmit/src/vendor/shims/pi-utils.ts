/**
 * Minimal re-implementation of the `@oh-my-pi/pi-utils` symbols the vendored
 * LSP subsystem consumes. Upstream imports these from
 * `@oh-my-pi/pi-utils`; stock Pi's extension loader does not alias that
 * package, so we vendor faithful Node-native replacements here and rewire the
 * vendored `lsp/*` imports to point at this module.
 *
 * Coverage: `logger`, `once`, `untilAborted`, `isEnoent`, `isRecord`,
 * `pathIsWithin`, `$which`, `$flag`, `truncate`, `AbortError`.
 * Not provided: `prompt` (TUI-only, used by the dropped `LspTool` class),
 * `getEditorConfigFormatting` (stubbed in `format-options.ts`), `ptree`
 * (replaced by `./proc`'s `nodeProcSpawn`).
 *
 * `$which` delegates to the `which` npm package (v7, ISC) for
 * PATH scanning — handles PATHEXT, mode-bit checks, and caching. The
 * package-local bin dir (`<pkg-root>/bin`) is still searched first for the
 * lspmux binary (4d), and absolute/relative paths are checked directly
 * (which.sync returns null for slashed paths).
 */
import { accessSync, constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import which from "which";

/** The extension's package-local bin dir (`<pkg-root>/bin`), resolved from
 * this module's location. lspmux (4d) installs here via postinstall
 * `cargo install --root <pkg-root>`, and `$which` searches it before `PATH`
 * so the bundled binary is picked up without polluting the user's PATH. */
const PACKAGE_LOCAL_BIN: string = (() => {
	try {
		// src/vendor/shims/pi-utils.ts → up 3 = pkg root → /bin
		return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "bin");
	} catch {
		return "";
	}
})();

// ── AbortError ─────────────────────────────────────────────────────────
export class AbortError extends Error {
	constructor(readonly signal: AbortSignal) {
		super("Operation aborted");
		this.name = "AbortError";
	}
}

// ── logger ─────────────────────────────────────────────────────────────
/** A no-op-ish logger. Upstream's logger is structured; we forward to
 * `console` only for warn/error (debug is silenced to avoid noise). The
 * vendored LSP code uses `logger.warn`/`logger.error`/`logger.debug`. */
export const logger = {
	debug(_msg: string, _ctx?: Record<string, unknown>): void {
		// silenced — LSP client is chatty on debug
	},
	warn(msg: string, ctx?: Record<string, unknown>): void {
		console.warn(`[lsp] ${msg}`, ctx ?? "");
	},
	error(msg: string, ctx?: Record<string, unknown>): void {
		console.error(`[lsp] ${msg}`, ctx ?? "");
	},
};

// ── once ───────────────────────────────────────────────────────────────
/** Memoize a zero-arg function (faithful port of upstream `once`). */
export function once<T>(fn: () => T): () => T {
	let store = undefined as { value: T } | undefined;
	return () => {
		if (store) return store.value;
		const value = fn();
		store = { value };
		return value;
	};
}

// ── untilAborted ───────────────────────────────────────────────────────
/**
 * Run a promise-returning function; reject with `AbortError` if `signal`
 * aborts first. Faithful port of upstream `untilAborted` (supports both
 * `() => Promise<T>` and a bare `Promise<T>` for the second arg).
 */
export function untilAborted<T>(
	signal: AbortSignal | undefined | null,
	pr: Promise<T> | (() => Promise<T>),
): Promise<T> {
	if (!signal) return typeof pr === "function" ? pr() : pr;
	if (signal.aborted) return Promise.reject(new AbortError(signal));
	const { promise, resolve, reject } = Promise.withResolvers<T>();
	const onAbort = () => reject(new AbortError(signal));
	signal.addEventListener("abort", onAbort, { once: true });
	void (async () => {
		try {
			resolve(await (typeof pr === "function" ? pr() : pr));
		} catch (err) {
			reject(err);
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	})();
	return promise;
}

// ── isEnoent / isRecord ────────────────────────────────────────────────
export function isEnoent(err: unknown): boolean {
	return (
		err instanceof Error &&
		"code" in err &&
		(err as { code?: unknown }).code === "ENOENT"
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── pathIsWithin ───────────────────────────────────────────────────────
/** True if `candidate` is `root` or inside `root` (faithful port). */
export function pathIsWithin(root: string, candidate: string): boolean {
	const normalizedRoot = resolve(root);
	const normalizedCandidate = resolve(candidate);
	const rel = relative(normalizedRoot, normalizedCandidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ── $which / $flag ─────────────────────────────────────────────────────
/**
 * Resolve `command` to an absolute path.
 *
 * - Absolute/relative paths: checked directly via `accessSync(X_OK)`.
 * - Bare command names: the package-local bin dir is searched first (so the
 *   lspmux binary is found without polluting PATH), then PATH is scanned via
 *   the `which` npm package (handles PATHEXT on Windows, mode bits, caching).
 *
 * Returns `null` when not found. Synchronous — called from the sync
 * `resolveCommand` in config.ts. Replaces the
 * hand-rolled PATH loop (which had a Windows `X_OK` bug) with `which.sync`.
 */
export function $which(command: string): string | null {
	// Absolute/relative path: check directly (which.sync returns null for
	// slashed paths since it only scans PATH).
	if (command.includes("/") || (process.platform === "win32" && command.includes("\\"))) {
		try {
			accessSync(command, constants.X_OK);
			return command;
		} catch {
			return null;
		}
	}
	// Search the package-local bin dir first (4d: lspmux lives here).
	if (PACKAGE_LOCAL_BIN) {
		const local = join(PACKAGE_LOCAL_BIN, command);
		try {
			accessSync(local, constants.X_OK);
			return local;
		} catch {
			// fall through to PATH search via which
		}
	}
	// Use which.sync for PATH search — handles PATHEXT, mode-bit checks,
	// and optional caching, fixing the Windows X_OK bug the hand-rolled
	// shim had (constants.X_OK === 0 on Windows, so accessSync always
	// returned true for any readable file).
	return which.sync(command, { nothrow: true }) || null;
}

/** Read a boolean flag (env var presence/truthiness). Replaces `$flag`. */
export function $flag(name: string): boolean {
	const v = process.env[name];
	if (v === undefined) return false;
	return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

// ── truncate ───────────────────────────────────────────────────────────
export function truncate(str: string, maxLen: number, ellipsis = "…"): string {
	if (str.length <= maxLen) return str;
	const sliceLen = Math.max(0, maxLen - ellipsis.length);
	return `${str.slice(0, sliceLen)}${ellipsis}`;
}
