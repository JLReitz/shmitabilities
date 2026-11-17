import { homedir } from "node:os";
import { getShmittyContext } from "../context.js";
import { appendBinToPath } from "../index.js";
import { registerPiContextHooks } from "./context.js";
/** Register the package environment with Pi. */
export default function activatePi(pi) {
    appendBinToPath();
    registerPiContextHooks(pi, {
        inspect: (cwd) => getShmittyContext(cwd, homedir()),
        emit: (context) => {
            pi.sendMessage({
                customType: "shmitty-context",
                content: context,
                display: false,
            }, { triggerTurn: false });
        },
        stderr: (value) => process.stderr.write(`${value}\n`),
    });
}
