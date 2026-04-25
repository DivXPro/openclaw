import { z } from "openclaw/plugin-sdk/zod";
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
