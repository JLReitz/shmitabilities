import type { Context } from "@deepseek-ai/cordis";
import { registerDsh } from "./register.js";

export const name = "llamas-and-shmit";
export const inject = ["agents", "llm", "loader"];

/**
 * Register the DSH lifecycle interface to the shared llama.cpp router.
 *
 * @param ctx - DSH context that receives the lifecycle hooks.
 */
export function apply(ctx: Context): void
{
    registerDsh(ctx);
}
