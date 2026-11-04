import { EventEmitter } from "node:events";
import { vi, type Mock } from "vitest";

export interface FakeChild extends EventEmitter {
  exitCode: number | null;
  signalCode: string | null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: Mock<[data: string], boolean> };
  kill: Mock<[signal: string], boolean>;
  emitExit(code?: number | null, signal?: string | null): void;
  emitStdout(data: string): void;
  emitStderr(data: string): void;
}

export function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn<[string], boolean>(() => true) };
  child.kill = vi.fn<[string], boolean>((signal) => {
    child.emitExit(null, signal);
    return true;
  });
  child.emitExit = (code = null, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  child.emitStdout = (data) => child.stdout.emit("data", data);
  child.emitStderr = (data) => child.stderr.emit("data", data);
  return child;
}
