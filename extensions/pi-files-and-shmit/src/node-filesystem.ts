/**
 * Disk-backed {@link Filesystem} for Node.js, built on `node:fs/promises`.
 *
 * The patched hashline dependency provides the portable {@link Filesystem}
 * base and {@link InMemoryFilesystem}; this extension owns the Node
 * implementation so no Bun-backed disk adapter reaches the runtime. The
 * patcher reads and writes through this adapter via the same abstract seam.
 */
import { access, constants, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type WriteResult, Filesystem, NotFoundError, isNotFound } from "@oh-my-pi/hashline";

export class NodeFilesystem extends Filesystem {
	async readText(path: string): Promise<string> {
		try {
			return await readFile(path, "utf-8");
		} catch (err) {
			if (isNotFound(err)) throw new NotFoundError(path, err);
			throw err;
		}
	}

	async readBinary(path: string): Promise<Uint8Array> {
		try {
			return await readFile(path);
		} catch (err) {
			if (isNotFound(err)) throw new NotFoundError(path, err);
			throw err;
		}
	}

	async writeText(path: string, content: string): Promise<WriteResult> {
		await writeFile(path, content, "utf-8");
		return { text: content };
	}

	async delete(path: string): Promise<void> {
		try {
			await rm(path);
		} catch (err) {
			if (isNotFound(err)) throw new NotFoundError(path, err);
			throw err;
		}
	}

	async move(from: string, to: string, content?: string): Promise<void> {
		if (content !== undefined) {
			await writeFile(to, content, "utf-8");
			await this.delete(from);
			return;
		}
		try {
			await rename(from, to);
		} catch (err) {
			if (isNotFound(err)) throw new NotFoundError(from, err);
			throw err;
		}
	}

	canonicalPath(path: string): string {
		return resolve(path);
	}

	async exists(path: string): Promise<boolean> {
		try {
			await access(path, constants.R_OK);
			return true;
		} catch {
			return false;
		}
	}
}
