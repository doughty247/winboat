import type { ComposeConfig } from "../../../types";

export type WinboatCredentials = {
    username: string;
    password: string;
};

export interface WinboatBackend {
    readonly id: string;

    parseCompose(): ComposeConfig;
    getCredentials(): WinboatCredentials;

    getContainerStatus(): Promise<string>;
    startContainer(compose: ComposeConfig): Promise<void>;
    stopContainer(): Promise<void>;
    pauseContainer(): Promise<void>;
    unpauseContainer(): Promise<void>;

    replaceCompose(composeConfig: ComposeConfig, isContainerRunning: boolean): Promise<void>;
    resetWinboat(compose: ComposeConfig): Promise<void>;
}
