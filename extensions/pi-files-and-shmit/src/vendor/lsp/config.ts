import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { $which, isRecord, logger } from "../shims/pi-utils";
// NOTE: upstream imports `YAML` from "bun" and `getConfigDirPaths` from
// `../config`, plus `getPreloadedPluginRoots`/`ClaudePluginRoot` from
// `../discovery/helpers`, and the Biome/SwiftLint linter clients. This
// vendored copy drops all of them: YAML is unsupported (JSON only, per the
// dependency-reduction goal), plugin/marketplace discovery is YAGNI for a
// stock-Pi extension, and linter integration is not shipped. Server overrides are read from `shmit.json` (see `getConfigSources`).
import { Minimatch } from "minimatch";
import DEFAULTS from "./defaults.json" with { type: "json" };
import type { ServerConfig } from "./types";

export interface LspConfig {
	servers: Record<string, ServerConfig>;
	/** Idle timeout in milliseconds. If set, LSP clients will be shutdown after this period of inactivity. Disabled by default. */
	idleTimeoutMs?: number;
}

// =============================================================================
// Default Server Configuration Loading
// =============================================================================

const PID_TOKEN = "$PID";

interface RawServerConfig extends Partial<ServerConfig> {
	extensionToLanguage?: unknown;
	initializationOptions?: unknown;
}

interface NormalizedConfig {
	servers: Record<string, RawServerConfig>;
	idleTimeoutMs?: number;
}

function parseConfigContent(content: string, filePath: string): unknown {
	// JSON only — YAML is intentionally unsupported (avoids a `yaml` runtime dep).
	// `filePath` is retained for upstream signature parity.
	void filePath;
	return JSON.parse(content) as unknown;
}

function normalizeConfig(value: unknown): NormalizedConfig | null {
	if (!isRecord(value)) return null;

	const idleTimeoutMs = typeof value.idleTimeoutMs === "number" ? value.idleTimeoutMs : undefined;
	const rawServers = value.servers;

	if (isRecord(rawServers)) {
		return { servers: rawServers as Record<string, RawServerConfig>, idleTimeoutMs };
	}

	const servers = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "idleTimeoutMs")) as Record<
		string,
		RawServerConfig
	>;

	return { servers, idleTimeoutMs };
}

function normalizeStringArray(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const items = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	return items.length > 0 ? items : null;
}
function normalizeExtensionToFileTypes(value: unknown): string[] | null {
	if (!isRecord(value)) return null;
	const extensions = Object.keys(value).filter(extension => extension.length > 0);
	return extensions.length > 0 ? extensions : null;
}

function normalizeServerConfig(name: string, config: RawServerConfig): ServerConfig | null {
	const command = typeof config.command === "string" && config.command.length > 0 ? config.command : null;
	const fileTypes =
		normalizeStringArray(config.fileTypes) ?? normalizeExtensionToFileTypes(config.extensionToLanguage);
	const rootMarkers = normalizeStringArray(config.rootMarkers) ?? (config.extensionToLanguage ? ["."] : null);

	if (!command || !fileTypes || !rootMarkers) {
		logger.warn("Ignoring invalid LSP server config (missing required fields).", { name });
		return null;
	}

	const args = Array.isArray(config.args)
		? config.args.filter((entry): entry is string => typeof entry === "string")
		: undefined;
	const initOptions = isRecord(config.initOptions)
		? config.initOptions
		: isRecord(config.initializationOptions)
			? config.initializationOptions
			: undefined;

	return {
		...config,
		command,
		args,
		fileTypes,
		rootMarkers,
		...(initOptions ? { initOptions } : {}),
	};
}

function readConfigFile(filePath: string): NormalizedConfig | null {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const parsed = parseConfigContent(content, filePath);
		return normalizeConfig(parsed);
	} catch {
		return null;
	}
}

function coerceServerConfigs(servers: Record<string, RawServerConfig>): Record<string, ServerConfig> {
	const result: Record<string, ServerConfig> = {};
	for (const [name, config] of Object.entries(servers)) {
		const normalized = normalizeServerConfig(name, config);
		if (normalized) {
			result[name] = normalized;
		}
	}
	return result;
}

function mergeServers(
	base: Record<string, ServerConfig>,
	overrides: Record<string, RawServerConfig>,
): Record<string, ServerConfig> {
	const merged: Record<string, ServerConfig> = { ...base };
	for (const [name, config] of Object.entries(overrides)) {
		if (merged[name]) {
			const candidate = { ...merged[name], ...config };
			const normalized = normalizeServerConfig(name, candidate);
			if (normalized) {
				merged[name] = normalized;
			} else {
				logger.warn("Ignoring invalid LSP overrides (keeping previous config).", { name });
			}
		} else {
			const normalized = normalizeServerConfig(name, config);
			if (normalized) {
				merged[name] = normalized;
			}
		}
	}
	return merged;
}

function applyRuntimeDefaults(servers: Record<string, ServerConfig>): Record<string, ServerConfig> {
	const updated: Record<string, ServerConfig> = { ...servers };

	// NOTE: upstream wires `BiomeClient.create` / `SwiftLintClient.create` as
	// linter factories here. Linter integration is not shipped,
	// so those registrations are omitted.

	if (updated.omnisharp?.args) {
		const args = updated.omnisharp.args.map(arg => (arg === PID_TOKEN ? String(process.pid) : arg));
		updated.omnisharp = { ...updated.omnisharp, args };
	}

	return updated;
}

// =============================================================================
// Configuration Loading
// =============================================================================

/**
 * Check if any root marker file exists in the directory
 */
export function hasRootMarkers(cwd: string, markers: string[]): boolean {
	let entries: string[] | null = null;
	for (const marker of markers) {
		// Handle glob-like patterns (e.g., "*.cabal"). Root markers live at the
		// project root, so a one-level readdir is sufficient — and avoids
		// Bun.Glob descending into node_modules for patterns like "**/*.cabal".
		if (marker.includes("*")) {
			if (entries === null) {
				try {
					entries = fs.readdirSync(cwd);
				} catch {
					entries = [];
					logger.warn("Failed to list directory for glob root marker.", { marker, cwd });
				}
			}
			const matcher = new Minimatch(marker);
			for (const entry of entries) {
				if (matcher.match(entry)) {
					return true;
				}
			}
			continue;
		}
		const filePath = path.join(cwd, marker);
		if (fs.existsSync(filePath)) {
			return true;
		}
	}
	return false;
}

// =============================================================================
// Local Binary Resolution
// =============================================================================

/**
 * Local bin directories to check before $PATH, ordered by priority.
 * Each entry maps a root marker to the bin directory to check.
 */
const LOCAL_BIN_PATHS: Array<{ markers: string[]; binDir: string }> = [
	// Node.js - check node_modules/.bin/
	{ markers: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"], binDir: "node_modules/.bin" },
	// Python - check virtual environment bin directories
	{ markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: ".venv/bin" },
	{ markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: "venv/bin" },
	{ markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: ".env/bin" },
	// Ruby - check vendor bundle and binstubs
	{ markers: ["Gemfile", "Gemfile.lock"], binDir: "vendor/bundle/bin" },
	{ markers: ["Gemfile", "Gemfile.lock"], binDir: "bin" },
	// Go - check project-local bin
	{ markers: ["go.mod", "go.sum"], binDir: "bin" },
];

const WINDOWS_LOCAL_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat"] as const;

function resolveLocalCommand(basePath: string): string | null {
	if (fs.existsSync(basePath)) return basePath;
	if (process.platform !== "win32") return null;

	// Package managers write Windows launchers with executable suffixes in node_modules/.bin.
	for (const extension of WINDOWS_LOCAL_EXECUTABLE_EXTENSIONS) {
		const candidate = `${basePath}${extension}`;
		if (fs.existsSync(candidate)) return candidate;
	}

	return null;
}

/**
 * Resolve a command to an executable path.
 * Checks project-local bin directories first, then falls back to $PATH.
 *
 * @param command - The command name (e.g., "typescript-language-server")
 * @param cwd - Working directory to search from
 * @returns Absolute path to the executable, or null if not found
 */
export function resolveCommand(command: string, cwd: string): string | null {
	// Check local bin directories based on project markers
	for (const { markers, binDir } of LOCAL_BIN_PATHS) {
		if (hasRootMarkers(cwd, markers)) {
			const localPath = path.join(cwd, binDir, command);
			const resolvedLocalPath = resolveLocalCommand(localPath);
			if (resolvedLocalPath) {
				return resolvedLocalPath;
			}
		}
	}

	// Fall back to $PATH
	return $which(command);
}

interface ConfigSource {
	read(): NormalizedConfig | null;
}

function fileConfigSource(filePath: string): ConfigSource {
	return {
		read: () => readConfigFile(filePath),
	};
}

/**
 * A config source backed by a `shmit.json` file. The extension's config is
 * single-file: behavioral flags (`lsp.enabled`,
 * `lsp.formatOnWrite`, …) are read by `src/lsp-settings.ts`, and LSP server
 * overrides live under the same file's `lsp.servers` (or top-level `servers`)
 * key. This reader extracts the server catalog portion.
 */
function shmitConfigSource(filePath: string): ConfigSource {
	return {
		read: () => readShmitServers(filePath),
	};
}

/** Read + normalize the `servers` portion of a `shmit.json` file. */
function readShmitServers(filePath: string): NormalizedConfig | null {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	// Accept either top-level `servers` or the namespaced `lsp.servers`.
	const lsp = parsed.lsp;
	const servers = isRecord(lsp) ? lsp.servers : parsed.servers;
	if (!isRecord(servers)) return { servers: {} };
	return normalizeConfig({ servers });
}

/**
 * Configuration sources in priority order (project > user). Each source is a
 * `shmit.json` file whose `lsp.servers` (or top-level `servers`) key overrides
 * the trimmed `defaults.json` catalog. Plugin/marketplace discovery and the
 * multi-filename `lsp.{json,yaml}` scan are dropped (YAGNI for a stock-Pi
 * extension; YAML unsupported).
 */
function getConfigSources(cwd: string): ConfigSource[] {
	return [
		shmitConfigSource(path.join(cwd, ".pi", "shmit.json")),
		shmitConfigSource(path.join(os.homedir(), ".pi", "shmit.json")),
	];
}

/**
 * Load LSP configuration.
 *
 * Priority (highest to lowest):
 * 1. Project config: `<cwd>/.pi/shmit.json` → `lsp.servers` (or top-level `servers`)
 * 2. User config: `~/.pi/shmit.json` → same shape
 * 3. Auto-detect from project markers + available binaries (defaults catalog)
 *
 * Config files are merged from lowest to highest priority; the project file
 * overrides the user file, and both override the trimmed `defaults.json`.
 *
 * Config file format (JSON only — YAML is unsupported):
 * ```json
 * {
 *   "lsp": {
 *     "enabled": true,
 *     "formatOnWrite": false,
 *     "servers": {
 *       "typescript-language-server": {
 *         "command": "typescript-language-server",
 *         "args": ["--stdio"],
 *         "disabled": false
 *       },
 *       "my-custom-server": {
 *         "command": "/path/to/server",
 *         "args": ["--stdio"],
 *         "fileTypes": [".xyz"],
 *         "rootMarkers": [".xyz-project"]
 *       }
 *     }
 *   }
 * }
 * ```
 */
export function loadConfig(cwd: string): LspConfig {
	let mergedServers = coerceServerConfigs(DEFAULTS);

	const configSources = getConfigSources(cwd).reverse();
	let hasOverrides = false;

	let idleTimeoutMs: number | undefined;
	for (const source of configSources) {
		const parsed = source.read();
		if (!parsed) continue;
		const hasServerOverrides = Object.keys(parsed.servers).length > 0;
		if (hasServerOverrides) {
			hasOverrides = true;
			mergedServers = mergeServers(mergedServers, parsed.servers);
		}
		if (parsed.idleTimeoutMs !== undefined) {
			idleTimeoutMs = parsed.idleTimeoutMs;
		}
	}

	if (!hasOverrides) {
		// Auto-detect: find servers based on project markers AND available binaries
		const detected: Record<string, ServerConfig> = {};
		const defaultsWithRuntime = applyRuntimeDefaults(mergedServers);

		for (const [name, config] of Object.entries(defaultsWithRuntime)) {
			// Check if project has root markers for this language
			if (!hasRootMarkers(cwd, config.rootMarkers)) continue;

			// Check if the language server binary is available (local or $PATH)
			const resolved = resolveCommand(config.command, cwd);
			if (!resolved) continue;

			detected[name] = { ...config, resolvedCommand: resolved };
		}

		return { servers: detected, idleTimeoutMs };
	}

	// Merge overrides with defaults and filter to available servers
	const mergedWithRuntime = applyRuntimeDefaults(mergedServers);
	const available: Record<string, ServerConfig> = {};

	for (const [name, config] of Object.entries(mergedWithRuntime)) {
		if (config.disabled) continue;
		if (!hasRootMarkers(cwd, config.rootMarkers)) continue;
		const resolved = resolveCommand(config.command, cwd);
		if (!resolved) continue;
		available[name] = { ...config, resolvedCommand: resolved };
	}

	return { servers: available, idleTimeoutMs };
}

// =============================================================================
// Server Selection
// =============================================================================

/**
 * Find all servers that can handle a file based on extension.
 * Returns servers matching the file (in catalog order).
 */
export function getServersForFile(config: LspConfig, filePath: string): Array<[string, ServerConfig]> {
	const ext = path.extname(filePath).toLowerCase();
	const extNoDot = ext.startsWith(".") ? ext.slice(1) : ext;
	const fileName = path.basename(filePath).toLowerCase();
	const matches: Array<[string, ServerConfig]> = [];

	for (const [name, serverConfig] of Object.entries(config.servers)) {
		const supportsFile = serverConfig.fileTypes.some(fileType => {
			// Accept both `.ts` and `ts` forms in user config / fixtures so a
			// missing dot in `fileTypes` doesn't silently exclude the server
			// from extension-based routing (e.g. rename_file's relevance filter).
			const normalized = fileType.toLowerCase();
			const normalizedNoDot = normalized.startsWith(".") ? normalized.slice(1) : normalized;
			return (
				normalized === ext ||
				normalized === fileName ||
				normalizedNoDot === extNoDot ||
				normalizedNoDot === fileName
			);
		});

		if (supportsFile) {
			matches.push([name, serverConfig]);
		}
	}

	// Return in catalog order. (Upstream sorted linters last via `isLinter`,
	// but this build ships no linter servers.)
	return matches;
}

/**
 * Find the primary server for a file.
 * Used for operations like definition, hover, references that need type intelligence.
 */
export function getServerForFile(config: LspConfig, filePath: string): [string, ServerConfig] | null {
	const servers = getServersForFile(config, filePath);
	return servers.length > 0 ? servers[0] : null;
}

/**
 * Check if a server has a specific capability
 */
export function hasCapability(
	config: ServerConfig,
	capability: keyof NonNullable<ServerConfig["capabilities"]>,
): boolean {
	return config.capabilities?.[capability] === true;
}
