#!/usr/bin/env node
/**
 * Native postinstall script for @jlreitz/pi-files-and-shmit. The package
 * lifecycle runs patch-package before invoking this file.
 *
 * Two isolated steps:
 *
 *  1. **Native ast crate** (load-bearing): `napi build ...` +
 *     smoke test. Fails loudly if `cargo` is missing — `ast_grep`/`ast_edit`
 *     depend on it.
 *  2. **lspmux** (best-effort): `cargo install lspmux --version
 *     0.3.0 --root <pkg-local-bin> --locked`. Wrapped in try/catch; on any
 *     failure (no cargo, network error, build error, --locked drift) it logs
 *     a warning and continues. The extension still works — LSP just spawns
 *     servers directly (transparent fall-through). Opt out with
 *     `SHMIT_NO_LSPMUX=1`.
 *
 * Critical: step 1 always requires Cargo and builds the complete locked native
 * graph during package installation. Step 2 remains optional: it detects
 * whether Cargo is present before attempting lspmux and never turns an
 * lspmux-only failure into an install failure.
 *
 * Note on cache scoping (adversarial review MINOR): `cargo install --root
 * <pkgRoot>` scopes only the final install prefix. Cargo still uses ambient
 * `CARGO_HOME` (~/.cargo) and `CARGO_TARGET_DIR` (or a temp dir under the
 * crate) for compilation. This is intentional — isolating these would break
 * cache sharing across packages and slow every subsequent install. The binary
 * itself lands at `<pkgRoot>/bin/lspmux` (package-local, not global).
 */
"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const pkgRoot = path.resolve(__dirname, "..");
const nativeDir = path.join(pkgRoot, "native");
const localBin = path.join(pkgRoot, "bin");

/** PATH with `node_modules/.bin` prepended (npm does this during postinstall;
 * we replicate it so the script also works when run directly). */
const nodeModulesBin = path.join(pkgRoot, "node_modules", ".bin");
const pathEnv =
	(nodeModulesBin + (process.platform === "win32" ? ";" : ":") + (process.env.PATH ?? ""));

/** Detect whether `cargo` is on PATH. */
function hasCargo() {
	const result = spawnSync("cargo", ["--version"], {
		stdio: "pipe",
		env: { ...process.env, PATH: pathEnv },
		windowsHide: true,
		timeout: 10_000,
	});
	return result.status === 0;
}

/** Step 1: native ast crate. Load-bearing — fails loudly. */
function buildNative() {
	if (!existsSync(nativeDir)) {
		// No native/ dir → nothing to build (e.g. a hashline-only checkout).
		return;
	}
	console.log("[pi-files-and-shmit] fetching locked native Rust dependencies…");
	const fetch = spawnSync(
		"cargo",
		["fetch", "--locked", "--manifest-path", path.join("native", "Cargo.toml")],
		{ stdio: "inherit", cwd: pkgRoot, env: { ...process.env, PATH: pathEnv }, windowsHide: true },
	);
	if (fetch.status !== 0) {
		console.error("[pi-files-and-shmit] ERROR: locked native Rust dependency fetch failed.");
		console.error("    The distributed package includes native/Cargo.lock; do not install without it.");
		process.exit(1);
	}
	console.log("[pi-files-and-shmit] building native ast crate (napi)…");
	const result = spawnSync(
		process.platform === "win32" ? "napi.cmd" : "napi",
		[
			"build",
			"--platform",
			"--release",
			"--no-const-enum",
			"--manifest-path",
			path.join("native", "Cargo.toml"),
			"--package-json-path",
			path.join("native", "package.json"),
			"--output-dir",
			"native",
		],
		{ stdio: "inherit", cwd: pkgRoot, env: { ...process.env, PATH: pathEnv }, windowsHide: true },
	);
	if (result.status !== 0) {
		console.error("[pi-files-and-shmit] ERROR: native ast build failed (napi).");
		console.error("    The `ast_grep` and `ast_edit` tools will not work without it.");
		console.error("    Ensure the Rust toolchain (`cargo`) is installed: https://rustup.rs");
		process.exit(1);
	}
	// Smoke test: import the built module and assert exports exist.
	const smoke = spawnSync("node", [path.join("native", "smoke-test.js")], {
		stdio: "inherit",
		cwd: pkgRoot,
		env: { ...process.env, PATH: pathEnv },
		windowsHide: true,
	});
	if (smoke.status !== 0) {
		console.error("[pi-files-and-shmit] ERROR: native ast smoke test failed.");
		process.exit(1);
	}
}

/** Step 2: lspmux. Best-effort — never fails the install. */
function buildLspmux() {
	if (process.env.SHMIT_NO_LSPMUX === "1") {
		console.log("[pi-files-and-shmit] SHMIT_NO_LSPMUX=1 → skipping lspmux build.");
		return;
	}
	if (!hasCargo()) {
		// Silent skip: lspmux is optional; the LSP subsystem falls through to
		// direct spawn. Hashline-only users have no cargo and no
		// native crate, so this is the expected path for them.
		return;
	}
	console.log("[pi-files-and-shmit] building lspmux (best-effort, may take a minute)…");
	try {
		if (!existsSync(localBin)) mkdirSync(localBin, { recursive: true });
		const result = spawnSync(
			"cargo",
			["install", "lspmux", "--version", "0.3.0", "--root", pkgRoot, "--locked"],
			{ stdio: "inherit", env: { ...process.env, PATH: pathEnv }, windowsHide: true },
		);
		if (result.status !== 0) {
			console.warn(
				"[pi-files-and-shmit] WARNING: lspmux build failed (cargo install exited non-zero)." +
					" LSP will spawn servers directly. Set SHMIT_NO_LSPMUX=1 to silence this.",
			);
			return;
		}
		console.log("[pi-files-and-shmit] lspmux built into bin/lspmux.");
	} catch (err) {
		console.warn(
			`[pi-files-and-shmit] WARNING: lspmux build skipped (${err?.message ?? err}).` +
				" LSP will spawn servers directly.",
		);
	}
}

buildNative();
buildLspmux();

// Export for unit tests (scripts/postinstall.test.cjs). When required (not
// executed directly), the functions above still run — the test stubs
// `child_process.spawnSync` before requiring this module, so the build calls
// hit the stubs and `process.exit` is monkey-patched to throw instead of exit.
module.exports = { buildNative, buildLspmux, hasCargo, __pkgRoot: pkgRoot };
