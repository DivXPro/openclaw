import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createSubagentQueryHandler, type CachedRun } from "./query-handler.js";

function createMockReq(overrides?: Partial<IncomingMessage>): IncomingMessage {
  return {
    method: "GET",
    url: "/plugins/subagent-webhook/runs?sessionKey=agent:main",
    ...overrides,
  } as unknown as IncomingMessage;
}

function createMockRes(): ServerResponse {
  const chunks: Buffer[] = [];
  return {
    statusCode: 200,
    setHeader: () => {},
    end: (data: string | Buffer) => {
      chunks.push(Buffer.from(data));
    },
    getBody: () => Buffer.concat(chunks).toString("utf-8"),
  } as unknown as ServerResponse & { getBody: () => string };
}

describe("createSubagentQueryHandler", () => {
  it("returns 400 when sessionKey is missing", async () => {
    const handler = createSubagentQueryHandler({ getRuns: () => [] });
    const req = createMockReq({ url: "/plugins/subagent-webhook/runs" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.getBody())).toMatchObject({ ok: false });
  });

  it("returns 405 for non-GET requests", async () => {
    const handler = createSubagentQueryHandler({ getRuns: () => [] });
    const req = createMockReq({ method: "POST" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it("filters runs by sessionKey", async () => {
    const runs: CachedRun[] = [
      {
        runId: "r1",
        childSessionKey: "agent:main:subagent:uuid1",
        status: "running",
        spawnedAt: 0,
      },
      {
        runId: "r2",
        childSessionKey: "agent:other:subagent:uuid2",
        status: "ended",
        spawnedAt: 0,
        endedAt: 1,
      },
    ];
    const handler = createSubagentQueryHandler({ getRuns: () => runs });
    const req = createMockReq({ url: "/plugins/subagent-webhook/runs?sessionKey=agent:main" });
    const res = createMockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.getBody());
    expect(body.ok).toBe(true);
    expect(body.total).toBe(1);
    expect(body.runs[0].runId).toBe("r1");
  });
});
