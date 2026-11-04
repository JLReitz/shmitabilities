import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPi } from "./register.js";

/**
 * Register router connection at Pi session startup and model selection.
 *
 * @param pi - Pi extension API that receives the lifecycle hooks.
 */
export default function activatePi(pi: ExtensionAPI): void
{
    registerPi(pi);
}
