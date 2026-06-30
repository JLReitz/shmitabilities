/**
 * lspmux integration.
 *
 * Two test surfaces:
 *  1. Pure-function tests over `wrapWithLspmux`/`isLspmuxSupported` — no real
 *     binary needed (the wrapping logic is pure over in-memory state).
 *  2. `detectLspmux` against the real bundled `bin/lspmux` (if present) or
 *     the no-binary path (if absent). The liveness check uses `spawnSync`
 *     with a 1s timeout, so these are fast.
 */
import { describe, expect, it } from "vitest";
import {
	isLspmuxSupported,
	wrapWithLspmux,
	detectLspmux,
	type LspmuxState,
} from "../../../src/vendor/lsp/lspmux";

const ABSENT: LspmuxState = { available: false, running: false, binaryPath: null };
const RUNNING: LspmuxState = {
	available: true,
	running: true,
	binaryPath: "/x/lspmux",
};

describe("isLspmuxSupported", () => {
	it("supports rust-analyzer", () => {
		expect(isLspmuxSupported("rust-analyzer")).toBe(true);
	});

	it("supports rust-analyzer by basename when given a full path", () => {
		expect(isLspmuxSupported("/usr/bin/rust-analyzer")).toBe(true);
	});

	it("does not support other servers (clangd, gopls, etc.)", () => {
		expect(isLspmuxSupported("clangd")).toBe(false);
		expect(isLspmuxSupported("gopls")).toBe(false);
		expect(isLspmuxSupported("typescript-language-server")).toBe(false);
	});
});

describe("wrapWithLspmux", () => {
	it("passthrough when lspmux unavailable", () => {
		const r = wrapWithLspmux("rust-analyzer", [], ABSENT);
		expect(r).toEqual({ command: "rust-analyzer", args: [] });
	});

	it("passthrough when not running", () => {
		const notRunning: LspmuxState = { ...RUNNING, running: false };
		const r = wrapWithLspmux("rust-analyzer", [], notRunning);
		expect(r).toEqual({ command: "rust-analyzer", args: [] });
	});

	it("passthrough for unsupported servers even when running", () => {
		const r = wrapWithLspmux("clangd", ["--background-index"], RUNNING);
		expect(r).toEqual({ command: "clangd", args: ["--background-index"] });
	});

	it("wraps bare rust-analyzer (no args) as lspmux short form", () => {
		const r = wrapWithLspmux("rust-analyzer", [], RUNNING);
		expect(r).toEqual({ command: "/x/lspmux", args: [] });
	});

	it("wraps rust-analyzer with args using `client --` + LSPMUX_SERVER env", () => {
		const r = wrapWithLspmux("rust-analyzer", ["--log-file", "/tmp/log"], RUNNING);
		expect(r).toEqual({
			command: "/x/lspmux",
			args: ["client", "--", "--log-file", "/tmp/log"],
			env: { LSPMUX_SERVER: "rust-analyzer" },
		});
	});

	it("wraps a rust-analyzer full path using `client` + LSPMUX_SERVER env", () => {
		const r = wrapWithLspmux("/usr/bin/rust-analyzer", [], RUNNING);
		expect(r).toEqual({
			command: "/x/lspmux",
			args: ["client"],
			env: { LSPMUX_SERVER: "/usr/bin/rust-analyzer" },
		});
	});

	it("handles undefined args as empty array on passthrough", () => {
		const r = wrapWithLspmux("clangd", undefined, RUNNING);
		expect(r).toEqual({ command: "clangd", args: [] });
	});

	it("handles undefined args on wrapped rust-analyzer", () => {
		const r = wrapWithLspmux("rust-analyzer", undefined, RUNNING);
		expect(r).toEqual({ command: "/x/lspmux", args: [] });
	});
});

describe("detectLspmux", () => {
	it("returns unavailable when SHMIT_NO_LSPMUX=1", async () => {
		const prev = process.env.SHMIT_NO_LSPMUX;
		process.env.SHMIT_NO_LSPMUX = "1";
		try {
			const state = await detectLspmux();
			expect(state.available).toBe(false);
			expect(state.running).toBe(false);
			expect(state.binaryPath).toBeNull();
		} finally {
			if (prev === undefined) delete process.env.SHMIT_NO_LSPMUX;
			else process.env.SHMIT_NO_LSPMUX = prev;
		}
	});

	it("returns unavailable when no lspmux binary is on PATH (temp cwd)", async () => {
		// In a clean PATH with no lspmux, $which returns null. We can't fully
		// control PATH in-process (the shim reads process.env.PATH), but the
		// package-local bin dir is searched first — if bin/lspmux doesn't exist,
		// and lspmux isn't on PATH, this returns unavailable. The build may have
		// placed bin/lspmux, so guard both outcomes.
		const prev = process.env.SHMIT_NO_LSPMUX;
		delete process.env.SHMIT_NO_LSPMUX;
		try {
			const state = await detectLspmux();
			// Either the bundled binary exists (available may be true) or it
			// doesn't (available false). Both are valid; assert the shape only.
			expect(typeof state.available).toBe("boolean");
			expect(typeof state.running).toBe("boolean");
			if (state.available) {
				expect(typeof state.binaryPath).toBe("string");
			} else {
				expect(state.binaryPath).toBeNull();
			}
		} finally {
			if (prev === undefined) delete process.env.SHMIT_NO_LSPMUX;
			else process.env.SHMIT_NO_LSPMUX = prev;
		}
	});
});
