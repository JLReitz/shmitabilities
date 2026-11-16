import { appendBinToPath } from "../index.js";
export const name = "shmitty-system-path";
/** Register the package environment with DSH. */
export function apply() {
    appendBinToPath();
}
