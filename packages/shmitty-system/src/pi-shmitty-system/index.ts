import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";

import { getShmittyContext } from "../context.js";
import { appendBinToPath } from "../index.js";
import { type PiContextApi, registerPiContextHooks } from "./context.js";

/** Register the package environment with Pi. */
export default function activatePi(pi: ExtensionAPI): void
{
    appendBinToPath();
    registerPiContextHooks(pi as unknown as PiContextApi, {
        inspect: (cwd) => getShmittyContext(cwd, homedir()),
        emit: (context) =>
        {
            pi.sendMessage({
                customType: "shmitty-context",
                content: context,
                display: false,
            }, { triggerTurn: false });
        },
        stderr: (value) => process.stderr.write(`${value}\n`),
    });
}
