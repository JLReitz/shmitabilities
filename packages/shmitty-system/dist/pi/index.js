import { appendBinToPath } from "../index.js";
/** Register the package environment with Pi. */
export default function activatePi(_pi) {
    appendBinToPath();
}
