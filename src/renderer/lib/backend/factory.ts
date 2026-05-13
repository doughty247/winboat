import type { WinboatBackend } from "./types";
import { DockerQemuBackend } from "./dockerQemuBackend";

export function createDefaultBackend(): WinboatBackend {
    return new DockerQemuBackend();
}
