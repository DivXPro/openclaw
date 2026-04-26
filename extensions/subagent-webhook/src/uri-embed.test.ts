import { describe, expect, it } from "vitest";
import type { UriSchemeConfig } from "./config.js";
import {
  parseUri,
  resolveUri,
  extractDisplayFields,
  buildDeliverable,
  extractDeliverablesFromMessages,
} from "./uri-embed.js";

const TEST_SCHEMES: Record<string, UriSchemeConfig> = {
  crm: {
    resources: {
      order: {
        webUrlTemplate: "https://crm.example.com/orders/{id}",
        apiUrlTemplate: "https://crm.example.com/api/orders/{id}",
        fields: {
          title: { path: "orderName" },
          subtitle: { path: "amount", format: "¥${value}" },
        },
      },
      customer: {
        webUrlTemplate: "https://crm.example.com/customers/{id}",
        fields: {
          title: { path: "customerName" },
        },
      },
    },
  },
  github: {
    resources: {
      issue: {
        webUrlTemplate: "https://github.com/{0}/{1}/issues/{2}",
        fields: {
          title: { path: "title" },
        },
      },
    },
  },
};

describe("parseUri", () => {
  it("parses simple uri", () => {
    const parsed = parseUri("crm://order/123");
    expect(parsed).toEqual({ scheme: "crm", resource: "order", id: "123" });
  });

  it("parses multi-segment id", () => {
    const parsed = parseUri("github://issue/openclaw/openclaw/456");
    expect(parsed).toEqual({ scheme: "github", resource: "issue", id: "openclaw/openclaw/456" });
  });

  it("returns null for invalid uri", () => {
    expect(parseUri("not-a-uri")).toBeNull();
    expect(parseUri("https://example.com")).toBeNull();
  });
});

describe("resolveUri", () => {
  it("resolves simple uri", () => {
    const resolved = resolveUri("crm://order/123", TEST_SCHEMES);
    expect(resolved).not.toBeNull();
    expect(resolved?.webUrl).toBe("https://crm.example.com/orders/123");
    expect(resolved?.apiUrl).toBe("https://crm.example.com/api/orders/123");
    expect(resolved?.scheme).toBe("crm");
    expect(resolved?.resource).toBe("order");
  });

  it("resolves multi-segment id", () => {
    const resolved = resolveUri("github://issue/openclaw/openclaw/456", TEST_SCHEMES);
    expect(resolved?.webUrl).toBe("https://github.com/openclaw/openclaw/issues/456");
  });

  it("returns null for unknown scheme", () => {
    expect(resolveUri("unknown://foo/123", TEST_SCHEMES)).toBeNull();
  });

  it("returns null for unknown resource", () => {
    expect(resolveUri("crm://invoice/123", TEST_SCHEMES)).toBeNull();
  });
});

describe("extractDisplayFields", () => {
  it("extracts simple fields", () => {
    const data = { orderName: "Order #123", amount: 1000 };
    const fields = TEST_SCHEMES.crm.resources.order.fields;
    const display = extractDisplayFields(data, fields);
    expect(display.title).toBe("Order #123");
    expect(display.subtitle).toBe("¥1000");
  });

  it("skips missing fields", () => {
    const data = { orderName: "Order #123" };
    const fields = TEST_SCHEMES.crm.resources.order.fields;
    const display = extractDisplayFields(data, fields);
    expect(display.title).toBe("Order #123");
    expect(display.subtitle).toBeUndefined();
  });

  it("handles nested paths", () => {
    const data = { customer: { name: "Alice" } };
    const fields = { title: { path: "customer.name" } };
    const display = extractDisplayFields(data, fields);
    expect(display.title).toBe("Alice");
  });
});

describe("buildDeliverable", () => {
  it("builds complete deliverable", () => {
    const data = { orderName: "Order #123", amount: 1000 };
    const d = buildDeliverable("crm://order/123", data, TEST_SCHEMES);
    expect(d).not.toBeNull();
    expect(d?.uri).toBe("crm://order/123");
    expect(d?.scheme).toBe("crm");
    expect(d?.resource).toBe("order");
    expect(d?.id).toBe("123");
    expect(d?._resolved.webUrl).toBe("https://crm.example.com/orders/123");
    expect(d?._resolved.apiUrl).toBe("https://crm.example.com/api/orders/123");
    expect(d?._display.title).toBe("Order #123");
    expect(d?._display.subtitle).toBe("¥1000");
    expect(d?.orderName).toBe("Order #123");
  });
});

describe("extractDeliverablesFromMessages", () => {
  it("extracts from toolResult with details.uri", () => {
    const messages = [
      {
        role: "toolResult",
        details: {
          uri: "crm://order/123",
          orderName: "Order #123",
          amount: 1000,
        },
      },
    ];
    const deliverables = extractDeliverablesFromMessages(messages, TEST_SCHEMES);
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.uri).toBe("crm://order/123");
    expect(deliverables[0]?._display.title).toBe("Order #123");
  });

  it("deduplicates by uri", () => {
    const messages = [
      { role: "toolResult", details: { uri: "crm://order/123", orderName: "A" } },
      { role: "toolResult", details: { uri: "crm://order/123", orderName: "B" } },
    ];
    const deliverables = extractDeliverablesFromMessages(messages, TEST_SCHEMES);
    expect(deliverables).toHaveLength(1);
  });

  it("returns empty for non-matching messages", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "toolResult", details: { stdout: "ok" } },
    ];
    const deliverables = extractDeliverablesFromMessages(messages, TEST_SCHEMES);
    expect(deliverables).toHaveLength(0);
  });
});
