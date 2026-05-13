import type { ComposeConfig } from "../../types";

const fs: typeof import("node:fs") = require("node:fs");

export const LOOKING_GLASS_DEVICE = "/dev/kvmfr0";
const IVSHMEM_DEVICE_ARG = "-device ivshmem-plain,memdev=ivshmem";
const IVSHMEM_MEMORY_ARG = "-object memory-backend-file,id=ivshmem,share=on,mem-path=/dev/kvmfr0,size=128M";

function ensureArg(args: string, arg: string): string {
    if (args.includes(arg)) {
        return args;
    }

    return `${args} ${arg}`.trim();
}

export function isLookingGlassDeviceAvailable(): boolean {
    return fs.existsSync(LOOKING_GLASS_DEVICE);
}

export function applyLookingGlassToCompose(compose: ComposeConfig): ComposeConfig {
    const next = JSON.parse(JSON.stringify(compose)) as ComposeConfig;

    if (!next.services.windows.devices.includes(LOOKING_GLASS_DEVICE)) {
        next.services.windows.devices.push(LOOKING_GLASS_DEVICE);
    }

    const existingArgs = next.services.windows.environment.ARGUMENTS || "";
    const withDevice = ensureArg(existingArgs, IVSHMEM_DEVICE_ARG);
    const withMemory = ensureArg(withDevice, IVSHMEM_MEMORY_ARG);

    next.services.windows.environment.ARGUMENTS = withMemory;
    return next;
}

export function removeLookingGlassFromCompose(compose: ComposeConfig): ComposeConfig {
    const next = JSON.parse(JSON.stringify(compose)) as ComposeConfig;

    next.services.windows.devices = next.services.windows.devices.filter(device => device !== LOOKING_GLASS_DEVICE);

    let args = next.services.windows.environment.ARGUMENTS || "";
    args = args.replace(IVSHMEM_DEVICE_ARG, "");
    args = args.replace(IVSHMEM_MEMORY_ARG, "");
    args = args.replace(/\s+/g, " ").trim();

    next.services.windows.environment.ARGUMENTS = args;
    return next;
}
