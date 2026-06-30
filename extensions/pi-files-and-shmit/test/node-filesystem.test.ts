import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFilesystem } from "../src/node-filesystem";
import { NotFoundError, isNotFound } from "@oh-my-pi/hashline";

describe("NodeFilesystem", () => {
	let dir: string;
	let fs: NodeFilesystem;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "hashline-nodefs-"));
		fs = new NodeFilesystem();
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("writes then reads text round-trip", async () => {
		const path = join(dir, "a.txt");
		await fs.writeText(path, "hello\nworld\n");
		expect(await fs.readText(path)).toBe("hello\nworld\n");
	});

	it("readText throws NotFoundError (ENOENT) for missing files", async () => {
		const path = join(dir, "missing.txt");
		const err = await fs.readText(path).catch(e => e);
		expect(err).toBeInstanceOf(NotFoundError);
		expect(isNotFound(err)).toBe(true);
	});

	it("readBinary returns raw bytes", async () => {
		const path = join(dir, "b.bin");
		await writeFile(path, Buffer.from([0xef, 0xbb, 0xbf, 0x41]));
		const bytes = await fs.readBinary(path);
		expect(Array.from(bytes)).toEqual([0xef, 0xbb, 0xbf, 0x41]);
	});

	it("delete removes a file and throws NotFoundError when already gone", async () => {
		const path = join(dir, "c.txt");
		await fs.writeText(path, "x");
		await fs.delete(path);
		expect(await fs.exists(path)).toBe(false);
		const err = await fs.delete(path).catch(e => e);
		expect(isNotFound(err)).toBe(true);
	});

	it("move without content renames the file", async () => {
		const from = join(dir, "from.txt");
		const to = join(dir, "to.txt");
		await fs.writeText(from, "payload");
		await fs.move(from, to);
		expect(await fs.exists(from)).toBe(false);
		expect(await fs.readText(to)).toBe("payload");
	});

	it("move without content throws NotFoundError when source missing", async () => {
		const err = await fs.move(join(dir, "nope.txt"), join(dir, "x.txt")).catch(e => e);
		expect(isNotFound(err)).toBe(true);
	});

	it("move with content writes destination text then deletes source", async () => {
		const from = join(dir, "src.txt");
		const to = join(dir, "dst.txt");
		await fs.writeText(from, "old");
		await fs.move(from, to, "new-content");
		expect(await fs.exists(from)).toBe(false);
		expect(await fs.readText(to)).toBe("new-content");
	});

	it("move with content to a missing parent dir fails (ENOENT) and leaves source", async () => {
		const from = join(dir, "src.txt");
		const to = join(dir, "missing", "dst.txt");
		await fs.writeText(from, "old");
		const err = await fs.move(from, to, "new").catch(e => e);
		expect(err).toBeInstanceOf(Error);
		// Source must still exist because the destination write failed first.
		expect(await fs.exists(from)).toBe(true);
	});

	it("canonicalPath resolves to an absolute path", () => {
		const canonical = fs.canonicalPath(join("rel", "a.txt"));
		expect(canonical.startsWith("/")).toBe(true);
		expect(canonical.endsWith(join("rel", "a.txt"))).toBe(true);
	});

	it("exists returns false for missing, true after write", async () => {
		const path = join(dir, "e.txt");
		expect(await fs.exists(path)).toBe(false);
		await fs.writeText(path, "x");
		expect(await fs.exists(path)).toBe(true);
	});

	it("can operate without chdir by using absolute paths", async () => {
		// Sanity: ensure tests do not depend on process.cwd() for disk ops.
		const nested = join(dir, "sub", "deep.txt");
		await mkdir(join(dir, "sub"), { recursive: true });
		await fs.writeText(nested, "deep");
		expect(await readFile(nested, "utf-8")).toBe("deep");
	});
});
