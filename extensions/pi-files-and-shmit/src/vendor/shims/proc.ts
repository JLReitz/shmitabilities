/**
 * Node `child_process` adapter replacing upstream's `ptree.spawn` for the
 * vendored LSP client.
 *
 * Upstream `client.ts` does:
 *   const proc = ptree.spawn([command, ...args], { cwd, stdin: "pipe", env });
 *   proc.stdin          — Bun.FileSink: .write(str), .flush()
 *   proc.stdout         — ReadableStream<Uint8Array> (Web stream) via .getReader()
 *   proc.exited         — Promise<number>
 *   proc.exitCode       — number (set after exit)
 *   proc.kill()
 *   proc.peekStderr()   — buffered stderr string (for crash diagnostics)
 *
 * This shim provides the same surface over `node:child_process.spawn`:
 *   - `stdin` is a {@link JsonRpcWriter} wrapping `child.stdin` (no `flush()` —
 *     Node's Writable already buffers and backpressures; the vendored
 *     `writeMessage` drops the `await sink.flush()` call).
 *   - `stdout` is a Web `ReadableStream<Uint8Array>` via `Readable.toWeb` so
 *     the vendored `startMessageReader` (which calls `.getReader().read()`)
 *     works unchanged. Node 22 ships `Readable.toWeb`.
 *   - `stderr` is buffered (capped at 64 KiB, tail-kept) and exposed via
 *     `peekStderr()`.
 *   - `exited` resolves on the child's `exit` event; `exitCode` is set then.
 */
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

/** A write-only frame sink replacing `Bun.FileSink` for JSON-RPC output. */
export class JsonRpcWriter {
	readonly #stream: NodeJS.WritableStream;
	constructor(stream: NodeJS.WritableStream) {
		this.#stream = stream;
	}
	/** Write a frame string. Node buffers internally — no `flush()` needed. */
	write(frame: string): void {
		this.#stream.write(frame);
	}
	/** Half-close the child's stdin. */
	end(): void {
		this.#stream.end();
	}
}

/** The proc surface the vendored LSP client consumes. */
export interface Proc {
	stdin: JsonRpcWriter;
	stdout: ReadableStream<Uint8Array>;
	readonly exited: Promise<number>;
	/** Exit code (0 if killed/null). Set after `exited` resolves. */
	exitCode: number;
	kill(): void;
	peekStderr(): string;
}

/** Stderr buffer cap (tail-kept beyond this). */
const STDERR_CAP = 64 * 1024;

/**
 * Spawn a child process with piped stdio, returning the {@link Proc} surface.
 * Mirrors upstream `ptree.spawn([cmd, ...args], { cwd, stdin: "pipe", env })`.
 */
export function nodeProcSpawn(
	cmd: string[],
	opts: { cwd: string; env?: Record<string, string> },
): Proc {
	const child = spawn(cmd[0]!, cmd.slice(1), {
		cwd: opts.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: opts.env ?? process.env,
		windowsHide: true,
	});

	let stderrBuf = "";
	child.stderr.on("data", (c: Buffer) => {
		stderrBuf += c.toString("utf-8");
		if (stderrBuf.length > STDERR_CAP) stderrBuf = stderrBuf.slice(-STDERR_CAP);
	});

	let exitCode = 0;
	const exited = new Promise<number>((resolve) => {
		child.on("exit", (code, signal) => {
			// Bun's `proc.exitCode` is null for signal kills; coerce to 0 so
			// downstream `code ?? 0`-style reads stay numeric. The `exited`
			// promise carries the same value.
			exitCode = code ?? 0;
			void signal;
			resolve(exitCode);
		});
		// If the child fails to spawn (ENOENT), `error` fires then `exit` (with
		// code -1 on posix). Surface that as exitCode 127 (command-not-found
		// convention) so callers see a recognizable code.
		child.on("error", (err) => {
			stderrBuf += `\n[proc spawn error: ${err.message}]\n`;
			exitCode = 127;
			resolve(127);
		});
	});

	// `Readable.toWeb` produces a `ReadableStream<Uint8Array>`. The vendored
	// reader does `Buffer.from(value)` on each chunk, which works on Uint8Array.
	const stdout = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;

	return {
		stdin: new JsonRpcWriter(child.stdin),
		stdout,
		exited,
		get exitCode() {
			return exitCode;
		},
		kill: () => {
			try {
				child.kill();
			} catch {
				// ignore — already dead
			}
		},
		peekStderr: () => stderrBuf,
	};
}
