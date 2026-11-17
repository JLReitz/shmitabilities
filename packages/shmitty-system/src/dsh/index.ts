import type { Context } from "@deepseek-ai/cordis";
import { homedir } from "node:os";

import { getShmittyContext } from "../context.js";
import { appendBinToPath } from "../index.js";
import { registerDshContextHooks } from "./context.js";

export const name = "shmitty-system-path";
export const inject = ["systemPrompt", "workingDirectory"];

/** Register the package environment with DSH. */
export function apply(ctx: Context): void
{
    appendBinToPath();
    registerDshContextHooks(ctx, {
        inspect: (cwd) => getShmittyContext(cwd, homedir()),
        stderr: (value) => process.stderr.write(`${value}\n`),
    });
}
