import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export enum LGClientStatus {
    STOPPED = 'stopped',
    STARTING = 'starting',
    RUNNING = 'running',
    ERROR = 'error',
}

export type LGClientConfig = {
    shmFile?: string;
    fullscreen?: boolean;
};

export class LookingGlassClient extends EventEmitter {
    private proc: ChildProcess | null = null;
    private status: LGClientStatus = LGClientStatus.STOPPED;
    private readonly config: Required<LGClientConfig>;
    private readonly clientPath: string;

    constructor(config: LGClientConfig = {}) {
        super();

        this.config = {
            shmFile: config.shmFile || '/dev/kvmfr0',
            fullscreen: config.fullscreen ?? false,
        };

        const devPath = path.join(__dirname, '../../src/native/looking-glass-client/looking-glass-client');
        const pkgPath = path.join(process.resourcesPath ?? '', 'native', 'looking-glass-client', 'looking-glass-client');
        this.clientPath = fs.existsSync(devPath) ? devPath : pkgPath;
    }

    async start(): Promise<void> {
        if (this.status === LGClientStatus.RUNNING) {
            return;
        }

        if (!fs.existsSync(this.clientPath)) {
            throw new Error(`Looking Glass client binary not found at ${this.clientPath}`);
        }

        if (!fs.existsSync(this.config.shmFile)) {
            throw new Error(`IVSHMEM device not found at ${this.config.shmFile}`);
        }

        this.status = LGClientStatus.STARTING;
        this.emit('status', this.status);

        const args = ['-f', this.config.shmFile];
        if (this.config.fullscreen) {
            args.push('-F');
        }

        this.proc = spawn(this.clientPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                DISPLAY: process.env.DISPLAY || ':0',
                WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || 'wayland-0',
            },
        });

        this.proc.stderr?.on('data', data => {
            this.emit('event', { type: 'output', message: data.toString() });
        });

        this.proc.on('error', err => {
            this.status = LGClientStatus.ERROR;
            this.emit('status', this.status);
            this.emit('event', { type: 'error', message: err.message });
        });

        this.proc.on('exit', () => {
            this.status = LGClientStatus.STOPPED;
            this.emit('status', this.status);
            this.proc = null;
        });

        this.status = LGClientStatus.RUNNING;
        this.emit('status', this.status);
    }

    async stop(): Promise<void> {
        if (!this.proc) {
            this.status = LGClientStatus.STOPPED;
            this.emit('status', this.status);
            return;
        }

        this.proc.kill('SIGTERM');
        this.proc = null;
        this.status = LGClientStatus.STOPPED;
        this.emit('status', this.status);
    }

    getStatus(): LGClientStatus {
        return this.status;
    }

    isRunning(): boolean {
        return this.status === LGClientStatus.RUNNING && !!this.proc && !this.proc.killed;
    }
}

let lgInstance: LookingGlassClient | null = null;

export function getLookingGlassClient(config?: LGClientConfig): LookingGlassClient {
    if (!lgInstance) {
        lgInstance = new LookingGlassClient(config);
    }

    return lgInstance;
}

export async function disposeLookingGlassClient(): Promise<void> {
    if (!lgInstance) {
        return;
    }

    await lgInstance.stop();
    lgInstance = null;
}
