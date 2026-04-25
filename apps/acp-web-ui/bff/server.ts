import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { WsAcpBridge } from "./ws-acp-bridge.js";

export interface BffServerOptions {
  port?: number;
  openclawBin?: string;
  gatewayUrl?: string;
  gatewayToken?: string;
  gatewayTokenFile?: string;
  gatewayPassword?: string;
  gatewayPasswordFile?: string;
}

export interface Closeable {
  close: () => void;
}

export function startBffServer(
  options: BffServerOptions = {},
): Promise<Closeable> {
  const port = options.port ?? 3100;
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    const childArgs: string[] = [];
    if (options.gatewayUrl) childArgs.push("--url", options.gatewayUrl);
    if (options.gatewayToken) childArgs.push("--token", options.gatewayToken);
    if (options.gatewayTokenFile)
      childArgs.push("--token-file", options.gatewayTokenFile);
    if (options.gatewayPassword)
      childArgs.push("--password", options.gatewayPassword);
    if (options.gatewayPasswordFile)
      childArgs.push("--password-file", options.gatewayPasswordFile);

    const bridge = new WsAcpBridge({
      ws,
      openclawBin: options.openclawBin,
      childArgs,
    });

    bridge.start().catch((err) => {
      console.error("[bff] bridge start failed:", err);
      ws.close(1011, "bridge start failed");
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`[bff] listening on ws://localhost:${port}`);
      resolve({
        close: () => {
          wss.close();
          httpServer.close();
        },
      });
    });
  });
}
