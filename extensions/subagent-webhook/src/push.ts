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
      deliverables?: unknown[];
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
