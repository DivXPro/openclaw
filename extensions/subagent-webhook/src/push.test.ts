import { describe, expect, it, vi } from "vitest";
import type { ResolvedWebhookTarget } from "./config.js";
import { pushToWebhook, pushToAllTargets } from "./push.js";

function mockFetch(response: Response): typeof fetch {
  return vi.fn(() => Promise.resolve(response)) as unknown as typeof fetch;
}

function makeTarget(overrides?: Partial<ResolvedWebhookTarget>): ResolvedWebhookTarget {
  return {
    targetId: "test",
    enabled: true,
    url: "https://example.com/hook",
    events: new Set(["spawned", "ended"]),
    ...overrides,
  };
}

describe("pushToWebhook", () => {
  it("returns ok on 200", async () => {
    const result = await pushToWebhook(
      makeTarget(),
      {
        type: "subagent_spawned",
        timestamp: 0,
        runId: "r1",
        childSessionKey: "k1",
        task: "t1",
        parentSessionKey: "agent:main",
      },
      { fetch: mockFetch(new Response("OK", { status: 200 })) },
    );
    expect(result.ok).toBe(true);
  });

  it("returns error on 500", async () => {
    const result = await pushToWebhook(
      makeTarget(),
      {
        type: "subagent_spawned",
        timestamp: 0,
        runId: "r1",
        childSessionKey: "k1",
        task: "t1",
        parentSessionKey: "agent:main",
      },
      { fetch: mockFetch(new Response("fail", { status: 500 })) },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("includes signature header when secret is set", async () => {
    const fetch = mockFetch(new Response("OK", { status: 200 }));
    await pushToWebhook(
      makeTarget({ secret: "shhh" }),
      {
        type: "subagent_spawned",
        timestamp: 0,
        runId: "r1",
        childSessionKey: "k1",
        task: "t1",
        parentSessionKey: "agent:main",
      },
      { fetch },
    );
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(call[1].headers).toMatchObject({
      "X-Webhook-Signature": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});

describe("pushToAllTargets", () => {
  it("skips targets that do not subscribe to the event", async () => {
    const fetch = mockFetch(new Response("OK", { status: 200 }));
    const targets = [
      makeTarget({ targetId: "spawn-only", events: new Set(["spawned"]) }),
      makeTarget({ targetId: "end-only", events: new Set(["ended"]) }),
    ];
    await pushToAllTargets(
      targets,
      {
        type: "subagent_ended",
        timestamp: 0,
        runId: "r1",
        childSessionKey: "k1",
        reason: "complete",
      },
      { fetch },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://example.com/hook");
  });
});
