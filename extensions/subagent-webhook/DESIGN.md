# Subagent Outbound Webhook Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OpenClaw plugin that pushes subagent lifecycle events (task spawn and result) to external HTTP endpoints, enabling out-of-band monitoring and integration.

**Architecture:** A bundled plugin (`extensions/subagent-webhook/`) that registers `subagent_spawned` and `subagent_ended` hooks to dispatch signed JSON payloads to configurable webhook URLs. It also exposes an HTTP query endpoint for external systems that prefer polling. Zero core changes — all behavior lives in the extension.

**Tech Stack:** TypeScript, ESM, `openclaw/plugin-sdk`, native `fetch`, HMAC-SHA256 signing.

---

## File Structure

| File                                                    | Responsibility                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `extensions/subagent-webhook/package.json`              | NPM metadata, `openclaw` field for setup/bundling                      |
| `extensions/subagent-webhook/openclaw.plugin.json`      | Plugin manifest: id, configSchema, contracts                           |
| `extensions/subagent-webhook/index.ts`                  | Plugin entrypoint: registers hooks and HTTP route                      |
| `extensions/subagent-webhook/api.ts`                    | Public SDK re-exports for internal use                                 |
| `extensions/subagent-webhook/runtime-api.ts`            | Runtime SDK re-exports (types, fetch, crypto)                          |
| `extensions/subagent-webhook/src/config.ts`             | Zod schema + resolver for plugin config (targets, secrets, filters)    |
| `extensions/subagent-webhook/src/push.ts`               | Outbound push logic: signing, fetch, retry, error handling             |
| `extensions/subagent-webhook/src/push.test.ts`          | Unit tests for push logic                                              |
| `extensions/subagent-webhook/src/query-handler.ts`      | HTTP route handler for `/plugins/subagent-webhook/runs` query endpoint |
| `extensions/subagent-webhook/src/query-handler.test.ts` | Unit tests for query endpoint                                          |

---

## Task 1: Scaffold Plugin Package

**Files:**

- Create: `extensions/subagent-webhook/package.json`
- Create: `extensions/subagent-webhook/openclaw.plugin.json`
- Create: `extensions/subagent-webhook/index.ts`
- Create: `extensions/subagent-webhook/api.ts`
- Create: `extensions/subagent-webhook/runtime-api.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@openclaw/subagent-webhook",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.ts",
  "openclaw": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `openclaw.plugin.json`**

```json
{
  "id": "subagent-webhook",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "$defs": {
      "secretRef": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "source": { "type": "string", "enum": ["env", "file", "exec"] },
          "provider": { "type": "string" },
          "id": { "type": "string" }
        },
        "required": ["source", "provider", "id"]
      },
      "secretInput": {
        "anyOf": [{ "type": "string", "minLength": 1 }, { "$ref": "#/$defs/secretRef" }]
      },
      "target": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": { "type": "boolean" },
          "url": { "type": "string", "format": "uri" },
          "secret": { "$ref": "#/$defs/secretInput" },
          "events": {
            "type": "array",
            "items": { "type": "string", "enum": ["spawned", "ended"] },
            "default": ["spawned", "ended"]
          }
        },
        "required": ["url"]
      }
    },
    "properties": {
      "targets": {
        "type": "object",
        "additionalProperties": { "$ref": "#/$defs/target" }
      },
      "queryEndpoint": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "enabled": { "type": "boolean", "default": true },
          "auth": { "type": "string", "enum": ["plugin", "gateway"], "default": "plugin" }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Create `api.ts`**

```ts
export { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk";
```

- [ ] **Step 4: Create `runtime-api.ts`**

```ts
export {
  normalizeOptionalString,
  normalizeLowercaseStringOrEmpty,
} from "openclaw/plugin-sdk/text-runtime";

export type { PluginRuntime, OpenClawConfig } from "openclaw/plugin-sdk/runtime-types";

export { safeEqualSecret } from "openclaw/plugin-sdk/browser-security-runtime";
export { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/config-secrets-runtime";
```

- [ ] **Step 5: Create stub `index.ts`**

```ts
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";

export default definePluginEntry({
  id: "subagent-webhook",
  name: "Subagent Outbound Webhook",
  description: "Push subagent lifecycle events to external HTTP endpoints.",
  register(api: OpenClawPluginApi) {
    api.logger.info?.("[subagent-webhook] registered");
  },
});
```

- [ ] **Step 6: Verify plugin loads in build**

Run: `pnpm build`
Expected: Build completes without errors; plugin is discoverable.

- [ ] **Step 7: Commit**

```bash
git add extensions/subagent-webhook/
git commit -m "feat(subagent-webhook): scaffold plugin package"
```

---

## Task 2: Config Schema and Resolver

**Files:**

- Create: `extensions/subagent-webhook/src/config.ts`
- Test: `extensions/subagent-webhook/src/config.test.ts`

- [ ] **Step 1: Write the config schema and resolver**

```ts
import { z } from "zod";
import {
  normalizeLowercaseStringOrEmpty,
  resolveConfiguredSecretInputString,
} from "../runtime-api.js";
import type { OpenClawConfig } from "../runtime-api.js";

const secretRefSchema = z
  .object({
    source: z.enum(["env", "file", "exec"]),
    provider: z.string().trim().min(1),
    id: z.string().trim().min(1),
  })
  .strict();

const secretInputSchema = z.union([z.string().trim().min(1), secretRefSchema]);

const targetSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    url: z.string().trim().min(1).url(),
    secret: secretInputSchema.optional(),
    events: z
      .array(z.enum(["spawned", "ended"]))
      .optional()
      .default(["spawned", "ended"]),
  })
  .strict();

const pluginConfigSchema = z
  .object({
    targets: z.record(z.string().trim().min(1), targetSchema).default({}),
    queryEndpoint: z
      .object({
        enabled: z.boolean().optional().default(true),
        auth: z.enum(["plugin", "gateway"]).optional().default("plugin"),
      })
      .optional()
      .default({}),
  })
  .strict();

export type WebhookTargetConfig = z.infer<typeof targetSchema>;
export type SubagentWebhookPluginConfig = z.infer<typeof pluginConfigSchema>;

export type ResolvedWebhookTarget = {
  targetId: string;
  enabled: boolean;
  url: string;
  secret?: string;
  events: Set<string>;
};

export function resolveSubagentWebhookConfig(pluginConfig: unknown): SubagentWebhookPluginConfig {
  return pluginConfigSchema.parse(pluginConfig ?? {});
}

export async function resolveWebhookTargets(
  cfg: OpenClawConfig,
  pluginConfig: SubagentWebhookPluginConfig,
): Promise<ResolvedWebhookTarget[]> {
  const results: ResolvedWebhookTarget[] = [];
  for (const [targetId, target] of Object.entries(pluginConfig.targets)) {
    if (!target.enabled) {
      continue;
    }
    let secret: string | undefined;
    if (target.secret) {
      if (typeof target.secret === "string") {
        secret = target.secret;
      } else {
        const resolved = await resolveConfiguredSecretInputString({
          config: cfg,
          env: process.env,
          value: target.secret,
          path: `plugins.entries.subagent-webhook.targets.${targetId}.secret`,
        });
        secret = resolved.value;
      }
    }
    results.push({
      targetId,
      enabled: target.enabled,
      url: target.url,
      secret,
      events: new Set(target.events.map((e) => normalizeLowercaseStringOrEmpty(e))),
    });
  }
  return results;
}
```

- [ ] **Step 2: Write config tests**

```ts
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
```

- [ ] **Step 3: Run tests**

Run: `pnpm test extensions/subagent-webhook/src/config.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add extensions/subagent-webhook/src/config.ts extensions/subagent-webhook/src/config.test.ts
git commit -m "feat(subagent-webhook): add config schema and resolver"
```

---

## Task 3: Outbound Push Logic

**Files:**

- Create: `extensions/subagent-webhook/src/push.ts`
- Test: `extensions/subagent-webhook/src/push.test.ts`

- [ ] **Step 1: Write the push module**

```ts
import crypto from "node:crypto";
import type { ResolvedWebhookTarget } from "./config.js";

export type SubagentWebhookPayload =
  | {
      type: "subagent_spawned";
      timestamp: number;
      runId: string;
      childSessionKey: string;
      task: string;
      label?: string;
      agentId?: string;
      parentSessionKey?: string;
      workspaceDir?: string;
      attachmentsDir?: string;
    }
  | {
      type: "subagent_ended";
      timestamp: number;
      runId?: string;
      childSessionKey: string;
      parentSessionKey?: string;
      reason: string;
      outcome?: "ok" | "error" | "timeout" | "killed" | "reset" | "deleted";
      error?: string;
      workspaceDir?: string;
      attachmentsDir?: string;
    };

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function pushToWebhook(
  target: ResolvedWebhookTarget,
  payload: SubagentWebhookPayload,
  deps?: { fetch?: typeof fetch },
): Promise<{ ok: boolean; error?: string }> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "OpenClaw-Subagent-Webhook/1.0",
  };

  if (target.secret) {
    headers["X-Webhook-Signature"] = signPayload(body, target.secret);
  }

  try {
    const response = await (deps?.fetch ?? fetch)(target.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return { ok: true };
    }

    const text = await response.text().catch(() => "");
    return {
      ok: false,
      error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pushToAllTargets(
  targets: ResolvedWebhookTarget[],
  payload: SubagentWebhookPayload,
  deps?: { fetch?: typeof fetch; logger?: { warn?: (msg: string) => void } },
): Promise<void> {
  const eventType = payload.type.replace("subagent_", "");
  const applicable = targets.filter((t) => t.events.has(eventType));

  await Promise.all(
    applicable.map(async (target) => {
      const result = await pushToWebhook(target, payload, deps);
      if (!result.ok) {
        deps?.logger?.warn?.(
          `[subagent-webhook] push to ${target.targetId} failed: ${result.error}`,
        );
      }
    }),
  );
}
```

- [ ] **Step 2: Write push tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { pushToWebhook, pushToAllTargets } from "./push.js";
import type { ResolvedWebhookTarget } from "./config.js";

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
```

- [ ] **Step 3: Run tests**

Run: `pnpm test extensions/subagent-webhook/src/push.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add extensions/subagent-webhook/src/push.ts extensions/subagent-webhook/src/push.test.ts
git commit -m "feat(subagent-webhook): add outbound push logic with HMAC signing"
```

---

## Task 4: Wire Hooks in Plugin Entrypoint

**Files:**

- Modify: `extensions/subagent-webhook/index.ts`

- [ ] **Step 1: Implement the full register function**

```ts
import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import {
  resolveSubagentWebhookConfig,
  resolveWebhookTargets,
  type ResolvedWebhookTarget,
} from "./src/config.js";
import { pushToAllTargets, type SubagentWebhookPayload } from "./src/push.js";

export default definePluginEntry({
  id: "subagent-webhook",
  name: "Subagent Outbound Webhook",
  description: "Push subagent lifecycle events to external HTTP endpoints.",
  register(api: OpenClawPluginApi) {
    const pluginConfig = resolveSubagentWebhookConfig(api.pluginConfig);
    let targets: ResolvedWebhookTarget[] = [];

    async function refreshTargets() {
      targets = await resolveWebhookTargets(api.config, pluginConfig);
      api.logger.info?.(`[subagent-webhook] ${targets.length} target(s) active`);
    }

    void refreshTargets();

    api.registerHook("subagent_spawned", async (event, ctx) => {
      if (targets.length === 0) return;
      // PluginHookSubagentSpawnedEvent does not include task/workspace/attachments;
      // resolve from registry by runId.
      const run = api.runtime.subagent?.getRun?.(event.runId);
      const task = (typeof run?.task === "string" ? run.task : undefined) ?? "";
      const payload: SubagentWebhookPayload = {
        type: "subagent_spawned",
        timestamp: Date.now(),
        runId: event.runId,
        childSessionKey: event.childSessionKey,
        task,
        label: event.label,
        agentId: event.agentId,
        parentSessionKey: ctx.requesterSessionKey,
        workspaceDir: typeof run?.workspaceDir === "string" ? run.workspaceDir : undefined,
        attachmentsDir: typeof run?.attachmentsDir === "string" ? run.attachmentsDir : undefined,
      };
      await pushToAllTargets(targets, payload, {
        logger: api.logger,
      });
    });

    api.registerHook("subagent_ended", async (event, ctx) => {
      if (targets.length === 0) return;
      // Resolve workspace/attachments from registry since ended hook event lacks them.
      const run = event.runId ? api.runtime.subagent?.getRun?.(event.runId) : undefined;
      const payload: SubagentWebhookPayload = {
        type: "subagent_ended",
        timestamp: Date.now(),
        runId: event.runId,
        childSessionKey: event.childSessionKey,
        parentSessionKey: ctx.requesterSessionKey,
        reason: event.reason,
        outcome: event.outcome,
        error: event.error,
        workspaceDir: typeof run?.workspaceDir === "string" ? run.workspaceDir : undefined,
        attachmentsDir: typeof run?.attachmentsDir === "string" ? run.attachmentsDir : undefined,
      };
      await pushToAllTargets(targets, payload, {
        logger: api.logger,
      });
    });

    api.logger.info?.("[subagent-webhook] hooks registered");
  },
});
```

- [ ] **Step 2: Build and verify no type errors**

Run: `pnpm build`
Expected: Build succeeds, no type errors in the plugin.

- [ ] **Step 3: Commit**

```bash
git add extensions/subagent-webhook/index.ts
git commit -m "feat(subagent-webhook): wire spawned and ended hooks"
```

---

## Task 5: HTTP Query Endpoint (Optional but Recommended)

**Files:**

- Create: `extensions/subagent-webhook/src/query-handler.ts`
- Modify: `extensions/subagent-webhook/index.ts`

- [ ] **Step 1: Create query handler**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginRuntime } from "../runtime-api.js";

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

export function createSubagentQueryHandler(params: {
  runtime: PluginRuntime;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return true;
    }

    const url = parseUrl(req);
    const sessionKey = url.searchParams.get("sessionKey")?.trim();
    if (!sessionKey) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "Missing sessionKey query param" }));
      return true;
    }

    try {
      const runs = params.runtime.subagent?.listRunsForRequester?.(sessionKey) ?? [];
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          total: runs.length,
          runs: runs.map((run: Record<string, unknown>) => ({
            runId: run.runId,
            childSessionKey: run.childSessionKey,
            task: run.task,
            label: run.label,
            status: run.endedAt ? "ended" : "running",
            outcome: run.outcome,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
          })),
        }),
      );
      return true;
    } catch (err) {
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : "unknown error",
        }),
      );
      return true;
    }
  };
}
```

- [ ] **Step 2: Register route in `index.ts`**

Add inside `register(api)` before the final logger call:

```ts
if (pluginConfig.queryEndpoint.enabled !== false) {
  api.registerHttpRoute({
    path: "/plugins/subagent-webhook/runs",
    auth: pluginConfig.queryEndpoint.auth,
    match: "exact",
    handler: createSubagentQueryHandler({ runtime: api.runtime }),
  });
  api.logger.info?.("[subagent-webhook] query endpoint registered");
}
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add extensions/subagent-webhook/src/query-handler.ts extensions/subagent-webhook/index.ts
git commit -m "feat(subagent-webhook): add HTTP query endpoint for run listing"
```

---

## Task 6: Documentation and Configuration Example

**Files:**

- Create: `extensions/subagent-webhook/README.md`

- [ ] **Step 1: Write plugin README**

````markdown
# Subagent Outbound Webhook

Push subagent lifecycle events to external HTTP endpoints.

## Events

### `subagent_spawned`

```json
{
  "type": "subagent_spawned",
  "timestamp": 1714041600000,
  "runId": "uuid",
  "childSessionKey": "agent:main:subagent:uuid",
  "task": "分析代码依赖关系",
  "label": "code-analysis",
  "agentId": "main",
  "parentSessionKey": "agent:main",
  "workspaceDir": "/Users/.../workspace/agent-main-uuid",
  "attachmentsDir": "/Users/.../attachments/agent-main-uuid"
}
```
````

### `subagent_ended`

```json
{
  "type": "subagent_ended",
  "timestamp": 1714041700000,
  "runId": "uuid",
  "childSessionKey": "agent:main:subagent:uuid",
  "parentSessionKey": "agent:main",
  "reason": "complete",
  "outcome": "ok"
}
```

### 字段详解

**`subagent_spawned`**（来自 `PluginHookSubagentSpawnedEvent` + `ctx.requesterSessionKey`）：

| 字段               | 类型      | 来源                                      | 说明                                                               |
| ------------------ | --------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `type`             | `string`  | 固定                                      | `subagent_spawned`                                                 |
| `timestamp`        | `number`  | `Date.now()`                              | 事件触发时间（毫秒）                                               |
| `runId`            | `string`  | `event.runId`                             | 子代理运行 ID                                                      |
| `childSessionKey`  | `string`  | `event.childSessionKey`                   | 子会话 key                                                         |
| `task`             | `string`  | `api.runtime.subagent.getRun(runId).task` | 子代理被分配的原始任务（hook event 不携带，插件自行查询 registry） |
| `label`            | `string?` | `event.label`                             | 可选标签                                                           |
| `agentId`          | `string?` | `event.agentId`                           | 子代理的目标 agent ID                                              |
| `parentSessionKey` | `string?` | `ctx.requesterSessionKey`                 | 父会话 key，如 `agent:main`                                        |
| `workspaceDir`     | `string?` | `run.workspaceDir`                        | 子代理工作区目录路径                                               |
| `attachmentsDir`   | `string?` | `run.attachmentsDir`                      | 子代理附件目录路径                                                 |

**`subagent_ended`**（来自 `PluginHookSubagentEndedEvent` + `ctx.requesterSessionKey`）：

| 字段               | 类型      | 来源                      | 说明                                                                  |
| ------------------ | --------- | ------------------------- | --------------------------------------------------------------------- |
| `type`             | `string`  | 固定                      | `subagent_ended`                                                      |
| `timestamp`        | `number`  | `Date.now()`              | 事件触发时间（毫秒）                                                  |
| `runId`            | `string?` | `event.runId`             | 子代理运行 ID                                                         |
| `childSessionKey`  | `string`  | `event.targetSessionKey`  | 子会话 key（hook 中叫 `targetSessionKey`）                            |
| `parentSessionKey` | `string?` | `ctx.requesterSessionKey` | 父会话 key                                                            |
| `reason`           | `string`  | `event.reason`            | 结束原因：`complete` / `error` / `killed` / `swept` 等                |
| `outcome`          | `string?` | `event.outcome`           | 运行结果：`ok` / `error` / `timeout` / `killed` / `reset` / `deleted` |
| `error`            | `string?` | `event.error`             | 当 outcome 为 `error` 时的错误信息                                    |
| `workspaceDir`     | `string?` | `run.workspaceDir`        | 子代理工作区目录路径（ended hook 不携带，插件自行查询 registry）      |
| `attachmentsDir`   | `string?` | `run.attachmentsDir`      | 子代理附件目录路径（ended hook 不携带，插件自行查询 registry）        |

---

## How to Register Webhook Targets

OpenClaw 使用 **`~/.openclaw/openclaw.json`**（JSON5 格式，支持注释）作为默认配置文件。环境变量 `OPENCLAW_CONFIG_PATH` 可覆盖该路径。

插件配置通过 **`plugins.entries.<plugin-id>`** 注册，这是 OpenClaw 插件系统原生支持的机制——**无需修改任何核心代码**。

### 配置注册步骤

1. 打开 `~/.openclaw/openclaw.json`
2. 在 `plugins.entries` 下添加 `subagent-webhook` 键
3. 配置 `targets` 对象：键为自定义目标 ID，值为 `{ url, secret?, events? }`
4. 保存文件后重启 OpenClaw gateway（`openclaw gateway restart`）或使用配置热重载

### 配置示例

```json5
{
  // ... 其他 OpenClaw 配置 ...
  plugins: {
    entries: {
      "subagent-webhook": {
        enabled: true,
        targets: {
          // 目标 ID 自定义，如 "mySystem"
          mySystem: {
            url: "https://my-system.com/openclaw-webhook",
            secret: { source: "env", provider: "webhook", id: "MY_SYSTEM_SECRET" },
            events: ["spawned", "ended"],
          },
          // 可注册多个目标
          backup: {
            url: "https://backup.example.com/hook",
            events: ["ended"], // 只接收 ended 事件
          },
        },
        queryEndpoint: {
          enabled: true,
          auth: "plugin",
        },
      },
    },
  },
}
```

### 配置字段说明

| 字段                    | 类型                    | 必填 | 说明                                         |
| ----------------------- | ----------------------- | ---- | -------------------------------------------- |
| `enabled`               | `boolean`               | 否   | 是否启用该插件配置，默认 `true`              |
| `targets`               | `object`                | 是   | 目标 webhook 字典，键为目标 ID，值为目标配置 |
| `targets.<id>.url`      | `string`                | 是   | Webhook 接收地址                             |
| `targets.<id>.secret`   | `string \| SecretRef`   | 否   | HMAC-SHA256 签名密钥                         |
| `targets.<id>.events`   | `string[]`              | 否   | 订阅的事件，`["spawned", "ended"]` 为默认    |
| `queryEndpoint.enabled` | `boolean`               | 否   | 是否启用 HTTP 查询端点，默认 `true`          |
| `queryEndpoint.auth`    | `"plugin" \| "gateway"` | 否   | 查询端点认证方式，默认 `"plugin"`            |

### Secret 配置方式

`secret` 支持两种形式：

**直接字符串**（仅测试使用，不推荐）：

```json5
secret: "my-webhook-secret"
```

**SecretRef**（推荐，从环境变量/文件/命令读取）：

```json5
secret: { source: "env", provider: "webhook", id: "MY_SYSTEM_SECRET" }
```

对应环境变量：`export MY_SYSTEM_SECRET="my-webhook-secret"`

## Verification

Webhook payloads are signed with HMAC-SHA256 when a secret is configured.
Verify the `X-Webhook-Signature` header:

```python
import hmac, hashlib
expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
assert hmac.compare_digest(expected, signature)
```

## Query Endpoint

```bash
curl -H "Authorization: Bearer $OPENCLAW_TOKEN" \
  http://localhost:8080/plugins/subagent-webhook/runs?sessionKey=agent:main
```

````

- [ ] **Step 2: Commit**

```bash
git add extensions/subagent-webhook/README.md
git commit -m "docs(subagent-webhook): add README with config and verification"
````

---

## Self-Review

**Spec coverage:**

- [x] Push subagent task on spawn → `subagent_spawned` hook + `pushToAllTargets`
- [x] Push subagent result on end → `subagent_ended` hook + `pushToAllTargets`
- [x] Multiple targets with event filtering → `ResolvedWebhookTarget.events` Set
- [x] Secret signing → HMAC-SHA256 in `push.ts`
- [x] HTTP query endpoint for polling → `query-handler.ts` + `registerHttpRoute`
- [x] Config schema with Zod validation → `config.ts`
- [x] No core modifications → everything lives in `extensions/`

**Placeholder scan:** None found. All steps contain concrete code.

**Type consistency:** `SubagentWebhookPayload` union used consistently across `push.ts` and `index.ts`. Config types aligned.

---

## URI Scheme Deliverables Design

### Problem

Subagents create external records (CRM orders, Jira tickets, GitHub issues) via CLI/skill. The webhook needs to capture these records as structured deliverables that receiving UIs can display uniformly.

Previous approaches had issues:

- Scanning `toolResult` JSON: requires CLI to output JSON, brittle
- Dedicated `create_record` tool: requires changing skills/tools
- File-based deliverables: requires filesystem access

### Solution: URI Scheme + Field Mapping

Inspired by URN/oEmbed, subagents embed a custom URI in their reply JSON. The webhook resolves the URI into web URL, API URL, and display fields via configured rules.

#### URI Format

```
{scheme}://{resource}/{id}
```

Examples:

- `crm://order/123`
- `jira://ticket/PROJ-789`
- `github://issue/openclaw/openclaw/456`

#### Config Schema Extension

```json5
{
  plugins: {
    entries: {
      "subagent-webhook": {
        uriSchemes: {
          crm: {
            resources: {
              order: {
                webUrlTemplate: "https://crm.example.com/orders/{id}",
                apiUrlTemplate: "https://crm.example.com/api/orders/{id}",
                fields: {
                  title: { path: "orderName" },
                  subtitle: { path: "amount", format: "¥${value}" },
                  image: { path: "customer.avatar" },
                  status: { path: "status" },
                },
              },
              customer: {
                webUrlTemplate: "https://crm.example.com/customers/{id}",
                apiUrlTemplate: "https://crm.example.com/api/customers/{id}",
                fields: {
                  title: { path: "customerName" },
                  image: { path: "avatar" },
                },
              },
            },
          },
        },
      },
    },
  },
}
```

#### Deliverable Payload Structure

```json
{
  "uri": "crm://order/123",
  "scheme": "crm",
  "resource": "order",
  "id": "123",
  "_resolved": {
    "webUrl": "https://crm.example.com/orders/123",
    "apiUrl": "https://crm.example.com/api/orders/123"
  },
  "_display": {
    "title": "订单 #123",
    "subtitle": "¥1000",
    "image": "https://crm.example.com/avatars/1.png",
    "status": "pending"
  }
}
```

#### Fields

| Field              | Source               | Description                             |
| ------------------ | -------------------- | --------------------------------------- |
| `uri`              | Subagent JSON        | Original URI, self-contained identifier |
| `scheme`           | Parsed from uri      | System name (`crm`)                     |
| `resource`         | Parsed from uri      | Resource type (`order`)                 |
| `id`               | Parsed from uri      | Resource ID (`123`)                     |
| `_resolved.webUrl` | Config template      | Human-readable link                     |
| `_resolved.apiUrl` | Config template      | Machine-readable API link               |
| `_display.*`       | Config field mapping | UI-agnostic display fields              |

#### Field Mapping Syntax

```json5
fields: {
  "title": { path: "orderName" },                    // simple path
  "subtitle": { path: "amount", format: "¥${value}" }, // with format
  "image": { path: "customer.avatar" },              // nested path
  "status": { path: "status" }                        // direct field
}
```

#### Resolution Flow

```
Subagent returns JSON with uri field
        ↓
Webhook extracts uri: "crm://order/123"
        ↓
Parse: scheme="crm", resource="order", id="123"
        ↓
Lookup config: uriSchemes.crm.resources.order
        ↓
Generate _resolved:
  webUrl = "https://crm.example.com/orders/123"
  apiUrl = "https://crm.example.com/api/orders/123"
        ↓
Generate _display:
  title = json.orderName
  subtitle = format("¥${value}", json.amount)
        ↓
Attach to payload.deliverables
```

### Implementation Tasks

- [ ] **Task A**: Add `uriSchemes` to config schema (`src/config.ts`)
- [ ] **Task B**: Create URI parser and resolver (`src/uri-embed.ts`)
- [ ] **Task C**: Create field extractor with path resolution and formatting
- [ ] **Task D**: Integrate into `subagent_ended` handler (`index.ts`)
- [ ] **Task E**: Add payload `deliverables` field (`src/push.ts`)
- [ ] **Task F**: Write tests for URI parsing, resolution, field extraction

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-subagent-outbound-webhook.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints

**Which approach?**
