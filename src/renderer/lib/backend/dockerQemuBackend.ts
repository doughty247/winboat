import type { ComposeConfig } from "../../../types";
import type { WinboatBackend, WinboatCredentials } from "./types";
import YAML from "yaml";
import PrettyYAML from "json-to-pretty-yaml";
import { WINBOAT_DIR } from "../constants";
import { createLogger } from "../../utils/log";

const fs: typeof import("fs") = require("fs");
const path: typeof import("path") = require("path");
const { promisify }: typeof import("util") = require("util");
const { exec }: typeof import("child_process") = require("child_process");

const execAsync = promisify(exec);
const logger = createLogger(path.join(WINBOAT_DIR, "winboat.log"));
const composeFilePath = path.join(WINBOAT_DIR, "docker-compose.yml");

export class DockerQemuBackend implements WinboatBackend {
    readonly id = "docker-qemu";

    parseCompose(): ComposeConfig {
        const composeFile = fs.readFileSync(composeFilePath, "utf-8");
        return YAML.parse(composeFile) as ComposeConfig;
    }

    getCredentials(): WinboatCredentials {
        const compose = this.parseCompose();
        return {
            username: compose.services.windows.environment.USERNAME,
            password: compose.services.windows.environment.PASSWORD,
        };
    }

    async getContainerStatus(): Promise<string> {
        try {
            const { stdout } = await execAsync('docker inspect --format="{{.State.Status}}" WinBoat');
            return stdout.trim();
        } catch {
            return "dead";
        }
    }

    async startContainer(compose: ComposeConfig): Promise<void> {
        await this.ensureComposePorts(compose);
        await execAsync("docker container start WinBoat");
    }

    async stopContainer(): Promise<void> {
        await execAsync("docker container stop WinBoat");
    }

    async pauseContainer(): Promise<void> {
        await execAsync("docker container pause WinBoat");
    }

    async unpauseContainer(): Promise<void> {
        await execAsync("docker container unpause WinBoat");
    }

    async replaceCompose(composeConfig: ComposeConfig, isContainerRunning: boolean): Promise<void> {
        if (isContainerRunning) {
            await this.stopContainer();
        }

        await execAsync(`docker compose -f ${composeFilePath} down`);

        const backupDir = path.join(WINBOAT_DIR, "backup");
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
            logger.info(`Created compose backup dir: ${backupDir}`);
        }

        const backupFile = `${Date.now()}-docker-compose.yml`;
        fs.renameSync(composeFilePath, path.join(backupDir, backupFile));
        logger.info(`Backed up current compose at: ${path.join(backupDir, backupFile)}`);

        const newComposeYAML = PrettyYAML.stringify(composeConfig).replaceAll("null", "");
        fs.writeFileSync(composeFilePath, newComposeYAML, { encoding: "utf8" });
        logger.info(`Wrote new compose file to: ${composeFilePath}`);

        await execAsync(`docker compose -f ${composeFilePath} up -d`);
        logger.info("Replace compose config completed, successfully deployed new container");
    }

    async resetWinboat(compose: ComposeConfig): Promise<void> {
        await this.stopContainer();
        await execAsync("docker rm WinBoat");

        const storage = compose.services.windows.volumes.find(vol => vol.includes("/storage"));
        if (storage?.startsWith("data:")) {
            await execAsync("docker volume rm winboat_data");
        } else {
            const storageFolder = storage?.split(":").at(0) ?? null;
            if (storageFolder && fs.existsSync(storageFolder)) {
                fs.rmSync(storageFolder, { recursive: true, force: true });
            }
        }

        fs.rmSync(WINBOAT_DIR, { recursive: true, force: true });
    }

    private async ensureComposePorts(compose: ComposeConfig): Promise<void> {
        // Keep behavior parity: runtime caller still owns deciding the final mapped ports.
        // We only sync the on-disk compose when the provided config differs.
        const current = this.parseCompose();
        const nextPorts = compose.services.windows.ports.join("|");
        const currentPorts = current.services.windows.ports.join("|");

        if (nextPorts === currentPorts) {
            return;
        }

        const newComposeYAML = PrettyYAML.stringify(compose).replaceAll("null", "");
        fs.writeFileSync(composeFilePath, newComposeYAML, { encoding: "utf8" });
        logger.info("Updated compose port mappings before container start");
    }
}
