/**
 * Minimal re-implementation of upstream `../tools/path-utils` symbols used by
 * the vendored LSP subsystem: `resolveToCwd`, `formatPathRelativeToCwd`.
 *
 * Upstream's versions handle Pi's internal-URL path scheme
 * (`normalizeLocalScheme`/`isInternalUrlPath`/`expandPath`); stock-Pi
 * extensions deal only in real filesystem paths, so this shim covers the
 * absolute/relative resolution + relative-to-cwd display cases the vendored
 * LSP code actually exercises.
 */
import { isAbsolute, relative, resolve } from "node:path";

/** Resolve `filePath` against `cwd` (absolute paths pass through). */
export function resolveToCwd(filePath: string, cwd: string): string {
	if (filePath === "" || /^\/+$/.test(filePath)) return cwd;
	if (isAbsolute(filePath)) return filePath;
	return resolve(cwd, filePath);
}

/**
 * Returns true if `filePath` resolves to a location at or under `cwd`.
 * Rejects `../` escapes and absolute paths outside the workspace.
 */
export function pathIsWithinCwd(filePath: string, cwd: string): boolean {
	const resolvedCwd = resolve(cwd);
	const resolvedPath = resolve(cwd, filePath);
	const rel = relative(resolvedCwd, resolvedPath);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Format `filePath` for display, relative to `cwd` when inside it. */
export function formatPathRelativeToCwd(
	filePath: string,
	cwd: string,
	_options: { trailingSlash?: boolean } = {},
): string {
	const resolvedCwd = resolve(cwd);
	const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
	const rel = relative(resolvedCwd, resolvedPath);
	const isWithin = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	// Normalize to posix separators for display consistency on Windows.
	const display = isWithin ? (rel || ".") : resolvedPath;
	return display.split("\\").join("/");
}
