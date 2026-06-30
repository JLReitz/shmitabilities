import { afterEach, describe, expect, it } from "vitest";
import { nodeProcSpawn, JsonRpcWriter } from "../../../src/vendor/shims/proc";
import { MessageFramer } from "../../../src/vendor/jsonrpc/message-framing";
import { spawn } from "node:child_process";

/**
 * A fake "LSP server" implemented in `node -e`: it reads Content-Length-framed
 * JSON-RPC requests from stdin and echoes each back as a response with `id`
 * preserved. This lets us round-trip a real frame through the Node proc adapter
 * + MessageFramer without depending on any real language server binary.
 */
const ECHO_SERVER = `
const fs = require('fs');
let buf = Buffer.alloc(0);
const headerRe = /Content-Length: (\\d+)/i;
function tryRead() {
  while (true) {
    const s = buf.toString('utf-8');
    const h = s.indexOf('\\r\\n\\r\\n');
    if (h === -1) return;
    const m = s.slice(0, h).match(headerRe);
    if (!m) { buf = buf.slice(h + 4); continue; }
    const len = parseInt(m[1], 10);
    const start = h + 4;
    if (buf.length < start + len) return;
    const text = buf.toString('utf-8', start, start + len);
    buf = buf.slice(start + len);
    let msg;
    try { msg = JSON.parse(text); } catch { continue; }
    const resp = { jsonrpc: '2.0', id: msg.id ?? null, result: { echoed: msg.method ?? null } };
    const body = JSON.stringify(resp);
    process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
  }
}
process.stdin.on('data', (c) => { buf = Buffer.concat([buf, c]); tryRead(); });
`;

function frame(obj: unknown): string {
	const body = JSON.stringify(obj);
	return `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n${body}`;
}

describe("proc shim + MessageFramer", () => {
	let proc: ReturnType<typeof nodeProcSpawn> | undefined;

	afterEach(() => {
		proc?.kill();
	});

	it("spawns a node echo server and round-trips a JSON-RPC request", async () => {
		proc = nodeProcSpawn(["node", "-e", ECHO_SERVER], { cwd: process.cwd() });
		const writer = proc.stdin;

		// Send an initialize request.
		writer.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));

		// Read stdout via the Web ReadableStream + MessageFramer.
		const reader = proc.stdout.getReader();
		const framer = new MessageFramer(Buffer.alloc(0));
		let received: unknown = undefined;
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && received === undefined) {
			const { done, value } = await reader.read();
			if (done) break;
			framer.push(Buffer.from(value));
			for (const text of framer.drain(() => {})) {
				received = JSON.parse(text);
				break;
			}
		}
		expect(received).toEqual({ jsonrpc: "2.0", id: 1, result: { echoed: "initialize" } });
	});

	it("peekStderr captures stderr output", async () => {
		proc = nodeProcSpawn(
			["node", "-e", "process.stderr.write('boom\\n'); setTimeout(() => {}, 50);"],
			{ cwd: process.cwd() },
		);
		// Poll for the stderr line instead of a fixed wait — under load (or in a
		// constrained sandbox) the child may take longer than a hard-coded
		// timeout to flush. Cap at 5s to stay bounded.
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && !proc.peekStderr().includes("boom")) {
			await new Promise((r) => setTimeout(r, 25));
		}
		expect(proc.peekStderr()).toContain("boom");
	});

	it("exited resolves to an exit code on normal exit", async () => {
		proc = nodeProcSpawn(["node", "-e", "process.exit(3)"], { cwd: process.cwd() });
		const code = await proc.exited;
		expect(code).toBe(3);
		expect(proc.exitCode).toBe(3);
	});

	it("kill() terminates a long-running child", async () => {
		proc = nodeProcSpawn(["node", "-e", "setInterval(() => {}, 1000);"], {
			cwd: process.cwd(),
		});
		// Wait for it to be running.
		await new Promise((r) => setTimeout(r, 100));
		proc.kill();
		const code = await proc.exited;
		// Killed children report null → we coerce to 0; the key invariant is
		// that `exited` resolves at all (the child is gone).
		expect(typeof code).toBe("number");
	});

	it("JsonRpcWriter writes frames without flush()", async () => {
		// Two-frame batch: confirm both arrive.
		proc = nodeProcSpawn(["node", "-e", ECHO_SERVER], { cwd: process.cwd() });
		const writer = proc.stdin;
		writer.write(frame({ jsonrpc: "2.0", id: 1, method: "a" }));
		writer.write(frame({ jsonrpc: "2.0", id: 2, method: "b" }));

		const reader = proc.stdout.getReader();
		const framer = new MessageFramer(Buffer.alloc(0));
		const ids: number[] = [];
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && ids.length < 2) {
			const { done, value } = await reader.read();
			if (done) break;
			framer.push(Buffer.from(value));
			for (const text of framer.drain(() => {})) {
				ids.push((JSON.parse(text) as { id: number }).id);
			}
		}
		expect(ids).toEqual([1, 2]);
	});
});

// Silence unused-import warnings for tools referenced only in comments.
void spawn;
void JsonRpcWriter;
