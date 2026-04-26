import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import {
  resolveSubagentWebhookConfig,
  resolveWebhookTargets,
  type ResolvedWebhookTarget,
} from "./src/config.js";
import { pushToAllTargets, type SubagentWebhookPayload } from "./src/push.js";
import { createSubagentQueryHandler, type CachedRun } from "./src/query-handler.js";
import { extractDeliverablesFromMessages, type Deliverable } from "./src/uri-embed.js";

function extractTextFromMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    for (const item of content) {
      if (
        item &&
        typeof item === "object" &&
        "type" in item &&
        (item as Record<string, unknown>).type === "text" &&
        "text" in item &&
        typeof (item as Record<string, unknown>).text === "string"
      ) {
        return (item as Record<string, unknown>).text as string;
      }
    }
  }
  return undefined;
}

async function resolveTaskFromSessionMessages(
  api: OpenClawPluginApi,
  childSessionKey: string,
): Promise<string> {
  try {
    const result = await api.runtime.subagent?.getSessionMessages?.({
      sessionKey: childSessionKey,
      limit: 10,
    });
    const messages = result?.messages ?? [];
    for (const msg of messages) {
      if (
        msg &&
        typeof msg === "object" &&
        "role" in msg &&
        (msg as Record<string, unknown>).role === "user"
      ) {
        const text = extractTextFromMessageContent((msg as Record<string, unknown>).content);
        if (text) {
          return text;
        }
      }
    }
  } catch {
    // Best-effort: ignore errors and return empty string
  }
  return "";
}

export default definePluginEntry({
  id: "subagent-webhook",
  name: "Subagent Outbound Webhook",
  description: "Push subagent lifecycle events to external HTTP endpoints.",
  register(api: OpenClawPluginApi) {
    const pluginConfig = resolveSubagentWebhookConfig(api.pluginConfig);
    let targets: ResolvedWebhookTarget[] = [];
    const runCache = new Map<string, CachedRun>();

    async function refreshTargets() {
      targets = await resolveWebhookTargets(api.config, pluginConfig);
      api.logger.info?.(`[subagent-webhook] ${targets.length} target(s) active`);
    }

    void refreshTargets();

    api.registerHook("subagent_spawned", async (event, ctx) => {
      if (targets.length === 0) return;
      const task = await resolveTaskFromSessionMessages(api, event.childSessionKey);
      runCache.set(event.runId, {
        runId: event.runId,
        childSessionKey: event.childSessionKey,
        task: task || undefined,
        label: event.label ?? undefined,
        status: "running",
        spawnedAt: Date.now(),
      });
      const payload: SubagentWebhookPayload = {
        type: "subagent_spawned",
        timestamp: Date.now(),
        runId: event.runId,
        childSessionKey: event.childSessionKey,
        task,
        label: event.label,
        agentId: event.agentId,
        parentSessionKey: ctx.requesterSessionKey,
      };
      await pushToAllTargets(targets, payload, {
        logger: api.logger,
      });
    });

    api.registerHook("subagent_ended", async (event, ctx) => {
      if (targets.length === 0) return;
      const cached = event.runId ? runCache.get(event.runId) : undefined;
      if (cached) {
        cached.status = "ended";
        cached.outcome = event.outcome ?? undefined;
        cached.reason = event.reason;
        cached.error = event.error ?? undefined;
        cached.endedAt = Date.now();
      }

      let deliverables: Deliverable[] = [];
      if (Object.keys(pluginConfig.uriSchemes).length > 0) {
        try {
          const result = await api.runtime.subagent?.getSessionMessages?.({
            sessionKey: event.childSessionKey,
            limit: 100,
          });
          deliverables = extractDeliverablesFromMessages(
            result?.messages ?? [],
            pluginConfig.uriSchemes,
          );
        } catch {
          // Best-effort: ignore errors
        }
      }

      const payload: SubagentWebhookPayload = {
        type: "subagent_ended",
        timestamp: Date.now(),
        runId: event.runId,
        childSessionKey: event.childSessionKey,
        parentSessionKey: ctx.requesterSessionKey,
        reason: event.reason,
        outcome: event.outcome,
        error: event.error,
        deliverables: deliverables.length > 0 ? deliverables : undefined,
      };
      await pushToAllTargets(targets, payload, {
        logger: api.logger,
      });
    });

    if (pluginConfig.queryEndpoint.enabled !== false) {
      api.registerHttpRoute({
        path: "/plugins/subagent-webhook/runs",
        auth: pluginConfig.queryEndpoint.auth,
        match: "exact",
        handler: createSubagentQueryHandler({
          getRuns: () => Array.from(runCache.values()),
        }),
      });
      api.logger.info?.("[subagent-webhook] query endpoint registered");
    }

    api.logger.info?.("[subagent-webhook] hooks registered");
  },
});
