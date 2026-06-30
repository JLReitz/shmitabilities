/**
 * lspmux integration for LSP server multiplexing — vendored from
 * `oh-my-pi/packages/coding-agent/src/lsp/lspmux.ts`.
 *
 * When lspmux is available and running, this module wraps supported LSP server
 * commands to use lspmux client mode, enabling server instance sharing across
 * multiple editor windows. Integration is transparent: if lspmux is
 * unavailable, falls back to direct spawning.
 *
 * Adaptations from upstream:
 *  - `import { $flag, $which, logger } from "@oh-my-pi/pi-utils"` →
 *    `$which` from `../shims/pi-utils` (which now searches the package-local
 *    `bin/` dir first, where the postinstall `cargo install` lands lspmux);
 *    `$flag("PI_DISABLE_LSPMUX")` → `process.env.SHMIT_NO_LSPMUX === "1"`;
 *    `logger.debug` → dropped (no logger shim; the shim's logger is silenced
 *    on debug by design).
 *  - `import { TOML } from "bun"` + `parseConfig()` + `getConfigPath()` →
 *    **removed entirely.** lspmux's daemon reads its own `config.toml`/
 *    `defaults.toml`; `wrapWithLspmux()` only reads `state.available`/
 *    `running`/`binaryPath`. Config parsing would require a TOML runtime dep
 *    (consistent with the YAML-drop decision) for no behavioral gain,
 *    so the `LspmuxConfig` type, `getConfigPath()`, and `parseConfig()` are
 *    gone, and the `config` field is dropped from `LspmuxState`.
 *  - `Bun.spawn([binaryPath, "status"])` + `proc.exited` + 1s `setTimeout`
 *    race (liveness check) → `child_process.spawnSync(binaryPath, ["status"],
 *    { timeout: 1000, windowsHide: true })`; check `status === 0`.
 *    `spawnSync` is cleaner than async `nodeProcSpawn` + `Promise.race` for a
 *    one-shot liveness probe. `proc.kill()` on timeout is not needed —
 *    `spawnSync`'s `timeout` kills the child itself.
 */
import { spawnSync } from "node:child_process";
import { $which } from "../shims/pi-utils";

// =============================================================================
// Types
// =============================================================================

export interface LspmuxState {
	available: boolean;
	running: boolean;
	binaryPath: string | null;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Servers that benefit from lspmux multiplexing.
 *
 * lspmux can multiplex any LSP server, but it's most beneficial for servers
 * with high startup cost or significant memory usage.
 */
const DEFAULT_SUPPORTED_SERVERS = new Set([
	"rust-analyzer",
	// Other servers can be added after testing with lspmux
]);

/** Timeout for liveness check (ms) */
const LIVENESS_TIMEOUT_MS = 1000;

/** Cache duration for lspmux state (5 minutes) */
const STATE_CACHE_TTL_MS = 5 * 60 * 1000;

// =============================================================================
// State Management
// =============================================================================

let cachedState: LspmuxState | null = null;
let cacheTimestamp = 0;

/**
 * Check if lspmux server is running via `lspmux status`.
 *
 * Uses `spawnSync` with a 1s timeout — cleaner than the upstream
 * `Bun.spawn` + `Promise.race(setTimeout)` pattern for a one-shot liveness
 * probe. `spawnSync`'s `timeout` sends SIGTERM after 1s; `lspmux status` is a
 * trivial command that exits cleanly, so this is sufficient in practice. If a
 * wedged probe ever becomes a real problem, switch to async `spawn` with an
 * explicit hard deadline + SIGKILL escalation (overkill today — YAGNI).
 */
function checkServerRunning(binaryPath: string): boolean {
	try {
		const result = spawnSync(binaryPath, ["status"], {
			stdio: "pipe",
			timeout: LIVENESS_TIMEOUT_MS,
			windowsHide: true,
		});
		return result.status === 0;
	} catch {
		return false;
	}
}

/**
 * Detect lspmux availability and state.
 * Results are cached for STATE_CACHE_TTL_MS.
 *
 * Set SHMIT_NO_LSPMUX=1 to disable (install-time opt-out; consistent with
 * the no-env-vars-for-settings rule — this is an install-time switch,
 * not a runtime setting).
 */
export async function detectLspmux(): Promise<LspmuxState> {
	const now = Date.now();
	if (cachedState && now - cacheTimestamp < STATE_CACHE_TTL_MS) {
		return cachedState;
	}

	if (process.env.SHMIT_NO_LSPMUX === "1") {
		cachedState = { available: false, running: false, binaryPath: null };
		cacheTimestamp = now;
		return cachedState;
	}

	const binaryPath = $which("lspmux");
	if (!binaryPath) {
		cachedState = { available: false, running: false, binaryPath: null };
		cacheTimestamp = now;
		return cachedState;
	}

	const running = checkServerRunning(binaryPath);

	cachedState = { available: true, running, binaryPath };
	cacheTimestamp = now;

	return cachedState;
}

// =============================================================================
// Command Wrapping
// =============================================================================

/**
 * Check if a server command is supported by lspmux.
 */
export function isLspmuxSupported(command: string): boolean {
	// Extract base command name (handle full paths)
	const baseName = command.split("/").pop() ?? command;
	return DEFAULT_SUPPORTED_SERVERS.has(baseName);
}

export interface LspmuxWrappedCommand {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

/**
 * Wrap a server command to use lspmux client mode.
 *
 * @param originalCommand - The original LSP server command (e.g., "rust-analyzer")
 * @param originalArgs - Original command arguments
 * @param state - lspmux state from detectLspmux()
 * @returns Wrapped command, args, and env vars; or original if lspmux unavailable
 */
export function wrapWithLspmux(
	originalCommand: string,
	originalArgs: string[] | undefined,
	state: LspmuxState,
): LspmuxWrappedCommand {
	if (!state.available || !state.running || !state.binaryPath) {
		return { command: originalCommand, args: originalArgs ?? [] };
	}

	if (!isLspmuxSupported(originalCommand)) {
		return { command: originalCommand, args: originalArgs ?? [] };
	}

	const baseName = originalCommand.split("/").pop() ?? originalCommand;
	const isDefaultRustAnalyzer = baseName === "rust-analyzer" && originalCommand === "rust-analyzer";
	const hasArgs = originalArgs && originalArgs.length > 0;

	// rust-analyzer from $PATH with no args - lspmux's default, simplest case
	if (isDefaultRustAnalyzer && !hasArgs) {
		return { command: state.binaryPath, args: [] };
	}

	// Use explicit `client` subcommand with LSPMUX_SERVER env var
	// Use `--` to separate lspmux options from server args
	const args = hasArgs ? ["client", "--", ...originalArgs] : ["client"];
	return {
		command: state.binaryPath,
		args,
		env: { LSPMUX_SERVER: originalCommand },
	};
}

/**
 * Get lspmux-wrapped command if available, otherwise return original.
 * This is the main entry point for client.ts integration.
 *
 * @param command - Original LSP server command
 * @param args - Original command arguments
 * @returns Command and args to use (possibly wrapped with lspmux)
 */
export async function getLspmuxCommand(command: string, args?: string[]): Promise<LspmuxWrappedCommand> {
	const state = await detectLspmux();
	return wrapWithLspmux(command, args, state);
}
