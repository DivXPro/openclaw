import { WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

export interface WsAcpBridgeOptions {
  ws: WebSocket;
  childArgs?: string[];
  /** Override the full spawn args list (skips the default "acp" prefix). Useful for testing. */
  spawnArgs?: string[];
  openclawBin?: string; // defaults to "openclaw"
  env?: Record<string, string>;
}

export class WsAcpBridge {
  private ws: WebSocket;
  private child: ChildProcess | null = null;
  private openclawBin: string;
  private spawnArgs: string[];
  private env: Record<string, string>;

  constructor(options: WsAcpBridgeOptions) {
    this.ws = options.ws;
    this.openclawBin = options.openclawBin ?? "openclaw";
    this.spawnArgs = options.spawnArgs ?? ["acp", ...(options.childArgs ?? [])];
    this.env = options.env ?? {};
  }

  async start(): Promise<void> {
    this.child = spawn(this.openclawBin, this.spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.env },
    });

    // child stdout (NDJSON) -> WS
    const rl = createInterface({ input: this.child.stdout! });
    rl.on("line", (line: string) => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(line);
      }
    });

    // child stderr -> log (don't forward to WS)
    this.child.stderr?.on("data", (data: Buffer) => {
      console.error(`[acp stderr] ${data.toString().trim()}`);
    });

    // WS message -> child stdin
    this.ws.on("message", (raw: Buffer) => {
      if (this.child?.stdin?.writable) {
        this.child.stdin.write(raw.toString() + "\n");
      }
    });

    // WS close -> kill child
    this.ws.on("close", () => {
      this.destroy();
    });

    // Child exit -> close WS
    this.child.on("exit", (code) => {
      console.log(`[acp] child exited with code ${code}`);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1011, "child process exited");
      }
    });

    // Wait for child to be ready (first stdout line or small delay)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 100);
      rl.once("line", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  destroy(): void {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      // Force kill after 5s
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill("SIGKILL");
        }
      }, 5000);
    }
    this.child = null;
  }
}
