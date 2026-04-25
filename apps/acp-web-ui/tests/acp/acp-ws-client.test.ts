import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { AcpWsClient } from "../../src/acp/acp-ws-client";
import type {
  InitializeResult,
  SessionUpdate,
  JsonRpcRequest,
} from "../../src/acp/acp-types";

describe("AcpWsClient", () => {
  let wss: WebSocketServer;
  let client: AcpWsClient;
  let port: number;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on("listening", resolve));
    port = (wss.address() as { port: number }).port;
  });

  afterEach(async () => {
    client?.disconnect();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  // Test 1: connect and initialize
  it("connects and initializes", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
      });
    });

    client = new AcpWsClient();
    const result = await client.connect(`ws://localhost:${port}`);
    expect(result.agentInfo.name).toBe("test-agent");
  });

  // Test 2: newSession
  it("creates a new session", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
        if (msg.method === "newSession") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { sessionId: "sess-1" },
            }),
          );
        }
      });
    });

    client = new AcpWsClient();
    await client.connect(`ws://localhost:${port}`);
    const session = await client.newSession({});
    expect(session.sessionId).toBe("sess-1");
  });

  // Test 3: receives session updates as events
  it("receives session updates as events", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
        if (msg.method === "prompt") {
          const updates: SessionUpdate[] = [
            {
              type: "agent_message_chunk",
              sessionId: "s1",
              delta: "Hello",
            },
            {
              type: "agent_message_chunk",
              sessionId: "s1",
              delta: " world",
            },
            { type: "prompt_finished", sessionId: "s1" },
          ];
          for (const u of updates) {
            ws.send(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "sessionUpdate",
                params: u,
              }),
            );
          }
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }));
        }
      });
    });

    client = new AcpWsClient();
    await client.connect(`ws://localhost:${port}`);

    const events: SessionUpdate[] = [];
    const off = client.onSessionUpdate((e) => events.push(e));

    await client.prompt("s1", [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("agent_message_chunk");
    expect(events[2].type).toBe("prompt_finished");

    off();
  });

  // Test 4: respondPermission
  it("sends permission response", async () => {
    const received: JsonRpcRequest[] = [];
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        received.push(msg);
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
        if (msg.id) {
          ws.send(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }),
          );
        }
      });
    });

    client = new AcpWsClient();
    await client.connect(`ws://localhost:${port}`);
    await client.respondPermission("pr-1", true);

    const permReq = received.find((r) => r.method === "requestPermission");
    expect(permReq).toBeDefined();
    expect(permReq!.params).toEqual({ id: "pr-1", approved: true });
  });

  // Test 5: disconnect rejects pending requests
  it("rejects pending requests on disconnect", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
        // intentionally don't respond to newSession
      });
    });

    client = new AcpWsClient();
    await client.connect(`ws://localhost:${port}`);

    const sessionPromise = client.newSession({});
    // Give the request a moment to be sent
    await new Promise((r) => setTimeout(r, 20));

    client.disconnect();

    await expect(sessionPromise).rejects.toThrow("Disconnected");
  });

  // Test 6: onClose handler fires when server closes connection
  it("fires onClose when server closes connection", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
      });
    });

    client = new AcpWsClient();
    await client.connect(`ws://localhost:${port}`);

    const closePromise = new Promise<void>((resolve) => {
      client.onClose(() => resolve());
    });

    // Force server to close all connections
    for (const c of wss.clients) {
      c.close();
    }

    await closePromise;
  });

  // Test 7: capabilities getter returns initialize result
  it("exposes capabilities after connect", async () => {
    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as JsonRpcRequest;
        if (msg.method === "initialize") {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: {
                agentInfo: { name: "test-agent" },
                capabilities: {
                  promptCapabilities: { text: true, image: false },
                },
              },
            }),
          );
        }
      });
    });

    client = new AcpWsClient();
    expect(client.capabilities).toBeNull();

    await client.connect(`ws://localhost:${port}`);
    expect(client.capabilities).not.toBeNull();
    expect(client.capabilities!.agentInfo.name).toBe("test-agent");
  });
});
