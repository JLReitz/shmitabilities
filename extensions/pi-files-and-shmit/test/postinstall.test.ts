/**
 * postinstall script unit tests.
 *
 * Tests the cargo-detection + skip logic with a stubbed child_process (no real
 * `cargo install` or `napi build` is run — that would be slow and
 * network-bound). Validates the best-effort contract: lspmux build never
 * fails the install, the native dependency graph is fetched with the shipped
 * lockfile, and SHMIT_NO_LSPMUX=1 skips only the optional lspmux build.
 *
 * The postinstall script is CommonJS (.cjs) because the package is
 * `"type":"module"`; we load it via `createRequire` after stubbing
 * `child_process.spawnSync`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"scripts",
	"postinstall.cjs",
);
const cp = require("node:child_process");
const realSpawnSync = cp.spawnSync;

interface SpawnCall {
	cmd: string;
	args: string[];
	opts?: Record<string, unknown>;
}

/** Stub `child_process.spawnSync` to capture calls and return canned results. */
function stubSpawnSync(
	overrides: Record<string, (args: string[], opts?: Record<string, unknown>) => { status: number; stdout?: string; stderr?: string }>,
): { calls: SpawnCall[]; restore: () => void } {
	const calls: SpawnCall[] = [];
	cp.spawnSync = ((cmd: string, args: string[], opts?: Record<string, unknown>) => {
		calls.push({ cmd, args, opts });
		const override = overrides[cmd];
		if (override) return override(args, opts);
		return { status: 0, stdout: "", stderr: "" };
	}) as typeof realSpawnSync;
	return { calls, restore: () => { cp.spawnSync = realSpawnSync; } };
}

describe("postinstall — lspmux best-effort logic", () => {
	let origEnv: Record<string, string | undefined>;
	let origExit: typeof process.exit;
	let exitCalls: number[];

	beforeEach(() => {
		origEnv = { ...process.env };
		origExit = process.exit;
		exitCalls = [];
		process.exit = ((code?: number) => {
			exitCalls.push(code ?? 0);
			throw new Error(`EXIT_${code ?? 0}`);
		}) as typeof process.exit;
		delete require.cache[SCRIPT_PATH];
	});

	afterEach(() => {
		process.env = origEnv;
		process.exit = origExit;
	});

	it("skips lspmux when SHMIT_NO_LSPMUX=1 but still fetches locked native dependencies", () => {
		process.env.SHMIT_NO_LSPMUX = "1";
		const { calls, restore } = stubSpawnSync({
			cargo: () => ({ status: 0, stdout: "cargo 1.0", stderr: "" }),
			napi: () => ({ status: 0, stdout: "", stderr: "" }),
			node: () => ({ status: 0, stdout: "", stderr: "" }),
		});
		try {
			require(SCRIPT_PATH);
		} catch {
			// process.exit throws; expected.
		}
		restore();
		const cargoCalls = calls.filter((c) => c.cmd === "cargo");
		expect(cargoCalls).toHaveLength(1);
		expect(cargoCalls[0].args).toEqual([
			"fetch",
			"--locked",
			"--manifest-path",
			path.join("native", "Cargo.toml"),
		]);
	});

	it("fails before lspmux when cargo cannot fetch native dependencies", () => {
		delete process.env.SHMIT_NO_LSPMUX;
		const { calls, restore } = stubSpawnSync({
			cargo: () => ({ status: 127, stdout: "", stderr: "not found" }),
			napi: () => ({ status: 0, stdout: "", stderr: "" }),
			node: () => ({ status: 0, stdout: "", stderr: "" }),
		});
		try {
			require(SCRIPT_PATH);
		} catch {
			// expected
		}
		restore();
		const cargoInstallCalls = calls.filter((c) => c.cmd === "cargo" && c.args[0] === "install");
		expect(cargoInstallCalls).toHaveLength(0);
	});

	it("attempts cargo install when cargo is present and no opt-out", () => {
		delete process.env.SHMIT_NO_LSPMUX;
		const { calls, restore } = stubSpawnSync({
			cargo: (args) => {
				if (args[0] === "--version") return { status: 0, stdout: "cargo 1.0", stderr: "" };
				return { status: 0, stdout: "", stderr: "" };
			},
			napi: () => ({ status: 0, stdout: "", stderr: "" }),
			node: () => ({ status: 0, stdout: "", stderr: "" }),
		});
		try {
			require(SCRIPT_PATH);
		} catch {
			// expected
		}
		restore();
		const installCalls = calls.filter((c) => c.cmd === "cargo" && c.args[0] === "install");
		expect(installCalls).toHaveLength(1);
		expect(installCalls[0].args).toContain("lspmux");
		expect(installCalls[0].args).toContain("0.3.0");
		expect(installCalls[0].args).toContain("--locked");
		// --root must point at the package root (not bin/) so the binary lands
		// at <pkg>/bin/lspmux (cargo creates <root>/bin/<binary>).
		const rootIdx = installCalls[0].args.indexOf("--root");
		expect(rootIdx).toBeGreaterThan(-1);
		const rootVal = installCalls[0].args[rootIdx + 1];
		expect(rootVal).toMatch(/pi-files-and-shmit$/);
	});

	it("fails the install when the locked native dependency fetch fails", () => {
		process.env.SHMIT_NO_LSPMUX = "1";
		const { restore } = stubSpawnSync({
			cargo: (args) => ({ status: args[0] === "fetch" ? 1 : 0, stdout: "", stderr: "fetch error" }),
			napi: () => ({ status: 0, stdout: "", stderr: "" }),
			node: () => ({ status: 0, stdout: "", stderr: "" }),
		});
		try {
			require(SCRIPT_PATH);
		} catch {
			// process.exit is stubbed to throw.
		}
		restore();
		expect(exitCalls).toContain(1);
	});

	it("does not fail the install when cargo install exits non-zero", () => {
		delete process.env.SHMIT_NO_LSPMUX;
		const { restore } = stubSpawnSync({
			cargo: (args) => {
				if (args[0] === "fetch" || args[0] === "--version") {
					return { status: 0, stdout: "cargo 1.0", stderr: "" };
				}
				return { status: 1, stdout: "", stderr: "build error" };
			},
			napi: () => ({ status: 0, stdout: "", stderr: "" }),
			node: () => ({ status: 0, stdout: "", stderr: "" }),
		});
		try {
			require(SCRIPT_PATH);
		} catch {
			// expected
		}
		restore();
		// The lspmux failure must not cause process.exit(1).
		expect(exitCalls).not.toContain(1);
	});
});
