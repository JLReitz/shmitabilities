import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_LSP_SETTINGS,
	resolveLspSettings,
	type LspSettings,
} from "../src/lsp-settings";

describe("lsp-settings", () => {
	let projectDir: string;
	let homeDir: string;

	beforeEach(async () => {
		projectDir = await mkdtemp(join(tmpdir(), "lsp-settings-proj-"));
		homeDir = await mkdtemp(join(tmpdir(), "lsp-settings-home-"));
	});

	afterEach(async () => {
		await Promise.all([
			rm(projectDir, { recursive: true, force: true }),
			rm(homeDir, { recursive: true, force: true }),
		]);
	});

	it("defaults when no config files exist", async () => {
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s).toEqual(DEFAULT_LSP_SETTINGS);
		expect(s.enabled).toBe(true);
		expect(s.formatOnWrite).toBe(false);
		expect(s.diagnosticsOnWrite).toBe(true);
		expect(s.deduplicate).toBe(false);
	});

	it("reads project .pi/shmit.json", async () => {
		await mkdir(join(projectDir, ".pi"));
		await writeFile(
			join(projectDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: { formatOnWrite: true } }),
		);
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s.formatOnWrite).toBe(true);
		expect(s.diagnosticsOnWrite).toBe(DEFAULT_LSP_SETTINGS.diagnosticsOnWrite);
	});

	it("reads ~/.pi/shmit.json when project config absent", async () => {
		await mkdir(join(homeDir, ".pi"));
		await writeFile(
			join(homeDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: { deduplicate: true } }),
		);
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s.deduplicate).toBe(true);
	});

	it("project overrides user per-field (first wins)", async () => {
		await mkdir(join(projectDir, ".pi"));
		await mkdir(join(homeDir, ".pi"));
		await writeFile(
			join(projectDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: { formatOnWrite: true } }),
		);
		await writeFile(
			join(homeDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: { formatOnWrite: false, deduplicate: true } }),
		);
		const s = await resolveLspSettings(projectDir, homeDir);
		// project wins on formatOnWrite
		expect(s.formatOnWrite).toBe(true);
		// user fills in fields project left undefined
		expect(s.deduplicate).toBe(true);
	});

	it("lsp.enabled:false short-circuits to disabled", async () => {
		await mkdir(join(projectDir, ".pi"));
		await writeFile(
			join(projectDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: { enabled: false } }),
		);
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s.enabled).toBe(false);
	});

	it("ignores malformed JSON (falls back to lower-priority source)", async () => {
		await mkdir(join(homeDir, ".pi"));
		await writeFile(join(homeDir, ".pi", "shmit.json"), "{ not valid json");
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s).toEqual(DEFAULT_LSP_SETTINGS);
	});

	it("ignores non-object lsp key", async () => {
		await mkdir(join(projectDir, ".pi"));
		await writeFile(
			join(projectDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: "oops" }),
		);
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s).toEqual(DEFAULT_LSP_SETTINGS);
	});

	it("does not throw when home .pi dir is missing", async () => {
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s).toEqual(DEFAULT_LSP_SETTINGS);
	});

	it("treats non-boolean field values as undefined (skips them)", async () => {
		await mkdir(join(projectDir, ".pi"));
		await writeFile(
			join(projectDir, ".pi", "shmit.json"),
			JSON.stringify({ lsp: { formatOnWrite: "yes", enabled: 1 } }),
		);
		const s = await resolveLspSettings(projectDir, homeDir);
		expect(s.formatOnWrite).toBe(false);
		expect(s.enabled).toBe(true);
	});
});

// Re-export for type-only usage elsewhere.
export type { LspSettings };
