import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendBinToPath } from "../index.js";

/** Register the package environment with Pi. */
export default function activatePi(_pi: ExtensionAPI): void
{
    appendBinToPath();
}
