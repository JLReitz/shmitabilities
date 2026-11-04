/**
 * Faithful re-implementation of upstream `../tools/tool-errors` symbols used
 * by the vendored LSP subsystem: `ToolError`, `ToolAbortError`,
 * `throwIfAborted`. Stock Pi's extension loader does not alias the
 * `@oh-my-pi/*` packages, so the vendored `lsp/*` imports are rewired here.
 */
export class ToolError extends Error {
	constructor(
		message: string,
		readonly context?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ToolError";
	}
	render(): string {
		return this.message;
	}
}

export class ToolAbortError extends Error {
	static readonly MESSAGE = "Operation aborted";
	constructor(message: string = ToolAbortError.MESSAGE) {
		super(message);
		this.name = "ToolAbortError";
	}
}

/** Throw `ToolAbortError` if `signal` is aborted (upstream uses this over
 * `signal.throwIfAborted()` for consistent error types). */
export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new ToolAbortError();
	}
}
