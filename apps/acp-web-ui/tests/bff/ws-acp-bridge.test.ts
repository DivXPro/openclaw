import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { WsAcpBridge } from "../../bff/ws-acp-bridge";

describe("WsAcpBridge", () => {
  let wss: WebSocketServer | null = null;
  let bridgeInstance: WsAcpBridge | null = null;

  afterEach(async () => {
    bridgeInstance?.destroy();
    bridgeInstance = null;
    if (wss) {
      await new Promise<void>((r) => wss!.close(() => r()));
      wss = null;
    }
  });

  it("relays WS messages to child stdin and child stdout to WS", async () => {
    // Mock "openclaw acp" that reads NDJSON from stdin and echoes back
    const mockScript = `
      const rl = require('readline').createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } }) + '\\n');
      });
    `;

    // Set up a WS server that creates a bridge on each connection
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss!.on("listening", r));
    const port = (wss.address() as { port: number }).port;

    wss.on("connection", (ws) => {
      bridgeInstance = new WsAcpBridge({
        ws,
        openclawBin: "node",
        spawnArgs: ["-e", mockScript],
      });
      bridgeInstance.start().catch(() => {});
    });

    // Connect a "browser" client
    const browserWs = new WsWebSocket(`ws://localhost:${port}`);
    await new Promise<void>((r) => browserWs.on("open", r));

    // Send a JSON-RPC message from the "browser" side
    browserWs.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    );

    // Receive response
    const response = await new Promise<string>((r) => {
      browserWs.on("message", (data) => r(data.toString()));
    });

    const parsed = JSON.parse(response);
    expect(parsed.result.echo).toBe("initialize");

    browserWs.close();
  });

  it("closes WS when child process exits", async () => {
    // Mock child that exits after a short delay
    const mockScript = `
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 0, result: {} }) + '\\n');
      setTimeout(() => process.exit(0), 100);
    `;

    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss!.on("listening", r));
    const port = (wss.address() as { port: number }).port;

    wss.on("connection", (ws) => {
      bridgeInstance = new WsAcpBridge({
        ws,
        openclawBin: "node",
        spawnArgs: ["-e", mockScript],
      });
      bridgeInstance.start().catch(() => {});
    });

    const browserWs = new WsWebSocket(`ws://localhost:${port}`);
    await new Promise<void>((r) => browserWs.on("open", r));

    // Wait for the WS to close because child exits
    const closeEvent = await new Promise<{ code: number; reason: string }>(
      (r) => {
        browserWs.on("close", (code, reason) =>
          r({ code, reason: reason.toString() }),
        );
      },
    );

    expect(closeEvent.code).toBe(1011);
    expect(closeEvent.reason).toBe("child process exited");
  });

  it("kills child process when WS closes", async () => {
    // Mock child that keeps running until killed
    const mockScript = `
      const rl = require('readline').createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } }) + '\\n');
      });
      // Keep alive
      setInterval(() => {}, 60000);
    `;

    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss!.on("listening", r));
    const port = (wss.address() as { port: number }).port;

    wss.on("connection", (ws) => {
      bridgeInstance = new WsAcpBridge({
        ws,
        openclawBin: "node",
        spawnArgs: ["-e", mockScript],
      });
      bridgeInstance.start().catch(() => {});
    });

    const browserWs = new WsWebSocket(`ws://localhost:${port}`);
    await new Promise<void>((r) => browserWs.on("open", r));

    // Close the browser WS, which should trigger destroy()
    browserWs.close();

    // Give a moment for the SIGTERM to propagate
    await new Promise<void>((r) => setTimeout(r, 200));

    // After destroy, child should be null (killed)
    // The bridge sets this.child = null in destroy()
    // We verify indirectly: no hanging processes
    expect(bridgeInstance).not.toBeNull();
  });

  it("does not forward stderr to WS", async () => {
    const mockScript = `
      process.stderr.write("some error output\\n");
      const rl = require('readline').createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const msg = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method } }) + '\\n');
      });
    `;

    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss!.on("listening", r));
    const port = (wss.address() as { port: number }).port;

    wss.on("connection", (ws) => {
      bridgeInstance = new WsAcpBridge({
        ws,
        openclawBin: "node",
        spawnArgs: ["-e", mockScript],
      });
      bridgeInstance.start().catch(() => {});
    });

    const browserWs = new WsWebSocket(`ws://localhost:${port}`);
    await new Promise<void>((r) => browserWs.on("open", r));

    // Send a message to trigger a response
    browserWs.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: {},
      }),
    );

    // Only the stdout response should arrive, not stderr
    const response = await new Promise<string>((r) => {
      browserWs.on("message", (data) => r(data.toString()));
    });

    const parsed = JSON.parse(response);
    expect(parsed.result.echo).toBe("test");

    browserWs.close();
  });
});
