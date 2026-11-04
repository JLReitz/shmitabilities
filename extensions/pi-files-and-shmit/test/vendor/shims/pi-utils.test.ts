import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { $which, $flag, once, isEnoent, isRecord, pathIsWithin, truncate } from "../../../src/vendor/shims/pi-utils";

// ── $which ──────────────────────────────────────────────────────────────

describe("$which", () => {
	it("resolves a real command on PATH", () => {
		const result = $which("node");
		expect(result).not.toBeNull();
		expect(result).toMatch(/node$/);
	});

	it("returns null for a nonsense command", () => {
		expect($which("nonexistent-command-xyz-nope")).toBeNull();
	});

	it("resolves an absolute path to an executable", () => {
		// /usr/bin/env is reliably present and executable on POSIX
		const result = $which("/usr/bin/env");
		expect(result).toBe("/usr/bin/env");
	});

	it("returns null for an absolute path to a nonexistent file", () => {
		expect($which("/nonexistent/path/to/binary")).toBeNull();
	});

	it("resolves a command in the package-local bin dir if present", () => {
		// The postinstall may have built lspmux into <pkg-root>/bin.
		// If it exists, $which should resolve it even when the bare name
		// is not on PATH.
		const result = $which("lspmux");
		if (result) {
			expect(result).toMatch(/bin\/lspmux$/);
		}
		// If lspmux wasn't built (no cargo, SHMIT_NO_LSPMUX), this is a
		// soft pass — the path just doesn't exist to resolve.
	});
});

// ── $flag ───────────────────────────────────────────────────────────────

describe("$flag", () => {
	const OLD_ENV = process.env;

	beforeEach(() => {
		process.env = { ...OLD_ENV };
	});

	afterEach(() => {
		process.env = OLD_ENV;
	});

	it("returns false for an unset env var", () => {
		expect($flag("SHMIT_TEST_UNSET")).toBe(false);
	});

	it("returns true for env var set to '1'", () => {
		process.env.SHMIT_TEST_FLAG = "1";
		expect($flag("SHMIT_TEST_FLAG")).toBe(true);
	});

	it("returns true for env var set to 'true'", () => {
		process.env.SHMIT_TEST_FLAG = "true";
		expect($flag("SHMIT_TEST_FLAG")).toBe(true);
	});

	it("returns true for env var set to 'yes'", () => {
		process.env.SHMIT_TEST_FLAG = "yes";
		expect($flag("SHMIT_TEST_FLAG")).toBe(true);
	});

	it("returns false for env var set to '0'", () => {
		process.env.SHMIT_TEST_FLAG = "0";
		expect($flag("SHMIT_TEST_FLAG")).toBe(false);
	});

	it("returns false for env var set to 'false'", () => {
		process.env.SHMIT_TEST_FLAG = "false";
		expect($flag("SHMIT_TEST_FLAG")).toBe(false);
	});
});

// ── once ────────────────────────────────────────────────────────────────

describe("once", () => {
	it("calls the factory only once", () => {
		let calls = 0;
		const fn = once(() => ++calls);
		expect(fn()).toBe(1);
		expect(fn()).toBe(1);
		expect(fn()).toBe(1);
		expect(calls).toBe(1);
	});

	it("memoizes the return value", () => {
		const fn = once(() => ({ key: "value" }));
		const a = fn();
		const b = fn();
		expect(a).toBe(b);
	});
});

// ── isEnoent ────────────────────────────────────────────────────────────

describe("isEnoent", () => {
	it("returns true for an Error with code ENOENT", () => {
		const err = new Error("not found");
		(err as any).code = "ENOENT";
		expect(isEnoent(err)).toBe(true);
	});

	it("returns false for a plain Error", () => {
		expect(isEnoent(new Error("something else"))).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isEnoent("string")).toBe(false);
		expect(isEnoent(null)).toBe(false);
		expect(isEnoent(undefined)).toBe(false);
	});
});

// ── isRecord ────────────────────────────────────────────────────────────

describe("isRecord", () => {
	it("returns true for plain objects", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
	});

	it("returns false for arrays", () => {
		expect(isRecord([])).toBe(false);
	});

	it("returns false for null", () => {
		expect(isRecord(null)).toBe(false);
	});

	it("returns false for primitives", () => {
		expect(isRecord("string")).toBe(false);
		expect(isRecord(42)).toBe(false);
	});
});

// ── pathIsWithin ────────────────────────────────────────────────────────

describe("pathIsWithin", () => {
	it("returns true when candidate is inside root", () => {
		expect(pathIsWithin("/a", "/a/b")).toBe(true);
		expect(pathIsWithin("/a", "/a/b/c/d")).toBe(true);
	});

	it("returns true when candidate equals root", () => {
		expect(pathIsWithin("/a", "/a")).toBe(true);
	});

	it("returns false when candidate is outside root", () => {
		expect(pathIsWithin("/a", "/b")).toBe(false);
		expect(pathIsWithin("/a", "/b/c")).toBe(false);
	});

	it("returns false for sibling paths", () => {
		expect(pathIsWithin("/a", "/a_other")).toBe(false);
	});
});

// ── truncate ────────────────────────────────────────────────────────────

describe("truncate", () => {
	it("returns the string unchanged when shorter than maxLen", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	it("truncates and appends ellipsis when longer than maxLen", () => {
		expect(truncate("hello world", 8)).toBe("hello w…");
	});

	it("uses the provided ellipsis character", () => {
		expect(truncate("hello world", 8, " [..]")).toBe("hel [..]");
	});
});