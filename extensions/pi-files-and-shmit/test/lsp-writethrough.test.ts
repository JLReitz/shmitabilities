/**
 * Unit tests for the writethrough factory.
 *
 * The factory's only logic is branching on resolved LSP settings into one of
 * three outcomes per consumer: `writethroughNoop` (disabled / both flags off),
 * a real writethrough closure (enabled + a flag on), or `undefined`
 * (`hashline_edit` when disabled). `createLspWritethrough` returns
 * `writethroughNoop` by identity when both `enableFormat` and
 * `enableDiagnostics` are false, so the disabled and "both flags off" cases
 * are both identity-equal to the exported `writethroughNoop` — no LSP server
 * is needed for these unit tests.
 */
import { describe, expect, it } from "vitest";
import { createWritethroughFactory } from "../src/lsp-writethrough";
import { writethroughNoop } from "../src/vendor/lsp";
import type { LspSettings } from "../src/lsp-settings";

function settings(over: Partial<LspSettings> = {}): LspSettings {
	return {
		enabled: true,
		formatOnWrite: false,
		diagnosticsOnWrite: true,
		deduplicate: false,
		...over,
	};
}

describe("createWritethroughFactory", () => {
	it("forAstEdit returns writethroughNoop when LSP disabled", async () => {
		const f = createWritethroughFactory(async () => settings({ enabled: false }));
		expect(await f.forAstEdit("/x")).toBe(writethroughNoop);
	});

	it("forAstEdit returns writethroughNoop when both format+diagnostics off", async () => {
		const f = createWritethroughFactory(
			async () => settings({ formatOnWrite: false, diagnosticsOnWrite: false }),
		);
		// createLspWritethrough short-circuits to writethroughNoop by identity.
		expect(await f.forAstEdit("/x")).toBe(writethroughNoop);
	});

	it("forAstEdit returns a real writethrough when formatOnWrite on", async () => {
		const f = createWritethroughFactory(
			async () => settings({ formatOnWrite: true, diagnosticsOnWrite: false }),
		);
		const w = await f.forAstEdit("/x");
		expect(w).not.toBe(writethroughNoop);
		expect(typeof w).toBe("function");
	});

	it("forAstEdit returns a real writethrough when diagnosticsOnWrite on", async () => {
		const f = createWritethroughFactory(
			async () => settings({ formatOnWrite: false, diagnosticsOnWrite: true }),
		);
		expect(await f.forAstEdit("/x")).not.toBe(writethroughNoop);
	});

	it("forHashlineEdit returns undefined when LSP disabled", async () => {
		const f = createWritethroughFactory(async () => settings({ enabled: false }));
		expect(await f.forHashlineEdit("/x")).toBeUndefined();
	});

	it("forHashlineEdit returns undefined when diagnosticsOnWrite off", async () => {
		const f = createWritethroughFactory(async () => settings({ diagnosticsOnWrite: false }));
		expect(await f.forHashlineEdit("/x")).toBeUndefined();
	});

	it("forHashlineEdit returns a real writethrough when enabled+diagnosticsOnWrite", async () => {
		const f = createWritethroughFactory(
			async () => settings({ enabled: true, diagnosticsOnWrite: true }),
		);
		const w = await f.forHashlineEdit("/x");
		expect(w).not.toBeUndefined();
		expect(w).not.toBe(writethroughNoop);
	});

	it("caches settings per cwd (resolve called once per cwd)", async () => {
		let calls = 0;
		const f = createWritethroughFactory(async (cwd) => {
			calls++;
			return settings();
		});
		await f.forAstEdit("/a");
		await f.forAstEdit("/a");
		await f.forHashlineEdit("/a");
		expect(calls).toBe(1);
		await f.forAstEdit("/b");
		expect(calls).toBe(2);
	});
});
