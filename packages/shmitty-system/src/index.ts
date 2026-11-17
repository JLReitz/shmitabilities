import path from "node:path";
import { fileURLToPath } from "node:url";

export {
    formatShmittyContext,
    getShmittyContext,
    inspectShmittyContext,
    type ProjectContext,
    type ShmittyContext,
    type WorkspaceContext,
} from "./context.js";

/** Append this package's bin directory to the current process PATH once. */
export function appendBinToPath(): void
{
    const bin = fileURLToPath(new URL("../bin/", import.meta.url));
    const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    if (!entries.includes(bin))
    {
        process.env.PATH = [...entries, bin].join(path.delimiter);
    }
}
