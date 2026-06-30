import { createFakeChild, type FakeChild } from "../helpers/fake-child.ts";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

export interface McpStdioHarness {
  child: FakeChild;
  requests: JsonRpcRequest[];
  writeRaw(data: string): void;
  respond(id: number, result: unknown): void;
  respondError(id: number, message?: string): void;
}

export function createMcpStdioHarness(options: { initialize?: "respond" | "exit" | "manual" } = {}): McpStdioHarness {
  const child = createFakeChild();
  const requests: JsonRpcRequest[] = [];
  let input = "";
  const initialize = options.initialize ?? "manual";

  const harness: McpStdioHarness = {
    child,
    requests,
    writeRaw(data) {
      child.emitStdout(data);
    },
    respond(id, result) {
      harness.writeRaw(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
    },
    respondError(id, message) {
      harness.writeRaw(`${JSON.stringify({ jsonrpc: "2.0", id, error: message === undefined ? {} : { message } })}\n`);
    },
  };

  child.stdin.write.mockImplementation((data: string) => {
    input += data;
    for (;;) {
      const newline = input.indexOf("\n");
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (!line) continue;
      const request = JSON.parse(line) as JsonRpcRequest;
      requests.push(request);
      if (request.method !== "initialize" || request.id === undefined) continue;
      queueMicrotask(() => {
        if (initialize === "respond") harness.respond(request.id!, {});
        if (initialize === "exit") child.emitExit(1, null);
      });
    }
    return true;
  });

  return harness;
}
