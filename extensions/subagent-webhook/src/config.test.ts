import { describe, expect, it } from "vitest";
import { resolveSubagentWebhookConfig } from "./config.js";

describe("resolveSubagentWebhookConfig", () => {
  it("parses minimal config with one target", () => {
    const cfg = {
      targets: {
        primary: { url: "https://example.com/hook" },
      },
    };
    const resolved = resolveSubagentWebhookConfig(cfg);
    expect(resolved.targets.primary?.url).toBe("https://example.com/hook");
    expect(resolved.targets.primary?.events).toEqual(["spawned", "ended"]);
    expect(resolved.targets.primary?.enabled).toBe(true);
  });

  it("rejects invalid url", () => {
    const cfg = {
      targets: {
        bad: { url: "not-a-url" },
      },
    };
    expect(() => resolveSubagentWebhookConfig(cfg)).toThrow();
  });

  it("filters disabled targets", () => {
    const cfg = {
      targets: {
        on: { url: "https://on.com", enabled: true },
        off: { url: "https://off.com", enabled: false },
      },
    };
    const resolved = resolveSubagentWebhookConfig(cfg);
    expect(resolved.targets.on?.enabled).toBe(true);
    expect(resolved.targets.off?.enabled).toBe(false);
  });
});
