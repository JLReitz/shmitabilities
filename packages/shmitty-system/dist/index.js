import path from "node:path";
import { fileURLToPath } from "node:url";
/** Append this package's bin directory to the current process PATH once. */
export function appendBinToPath() {
    const bin = fileURLToPath(new URL("../bin/", import.meta.url));
    const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    if (!entries.includes(bin)) {
        process.env.PATH = [...entries, bin].join(path.delimiter);
    }
}
