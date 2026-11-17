import { homedir } from "node:os";

import { getShmittyContext } from "../context.js";
import { type CodexContextHookInput, runCodexContextHook } from "./context-hook.js";

interface CodexHookJson
{
    cwd?: unknown;
    hook_event_name?: unknown;
    session_id?: unknown;
    source?: unknown;
}

async function readStandardInput(): Promise<string>
{
    process.stdin.setEncoding("utf8");
    let input = "";
    for await (const chunk of process.stdin)
    {
        input += chunk;
    }
    return input;
}

function parseInput(value: string): CodexContextHookInput
{
    const input = JSON.parse(value) as CodexHookJson;
    if ((input.hook_event_name !== "SessionStart") && (input.hook_event_name !== "UserPromptSubmit"))
    {
        throw new Error("Codex context hook failed: hook_event_name is not supported");
    }
    if ((typeof input.session_id !== "string") || (input.session_id === ""))
    {
        throw new Error("Codex context hook failed: session_id is required");
    }
    if ((typeof input.cwd !== "string") || (input.cwd === ""))
    {
        throw new Error("Codex context hook failed: cwd is required");
    }

    return {
        hookEventName: input.hook_event_name,
        sessionId: input.session_id,
        cwd: input.cwd,
        source: typeof input.source === "string" ? input.source : undefined,
    };
}

async function main(): Promise<0>
{
    try
    {
        const pluginData = process.env.PLUGIN_DATA;
        if ((pluginData === undefined) || (pluginData === ""))
        {
            throw new Error("Codex context hook failed: PLUGIN_DATA is required");
        }

        const input = parseInput(await readStandardInput());
        return await runCodexContextHook(input, {
            pluginData,
            inspect: (cwd) => getShmittyContext(cwd, homedir()),
            io: {
                stderr: (value) => process.stderr.write(`${value}\n`),
                stdout: (value) => process.stdout.write(value),
            },
        });
    }
    catch (error)
    {
        const text = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${text}\n`);
        return 0;
    }
}

process.exitCode = await main();
