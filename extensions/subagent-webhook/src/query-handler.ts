import type { IncomingMessage, ServerResponse } from "node:http";

export type CachedRun = {
  runId: string;
  childSessionKey: string;
  task?: string;
  label?: string;
  status: "running" | "ended";
  outcome?: string;
  reason?: string;
  error?: string;
  spawnedAt: number;
  endedAt?: number;
};

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://localhost");
}

export function createSubagentQueryHandler(params: {
  getRuns: () => CachedRun[];
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
      const allRuns = params.getRuns();
      const runs = allRuns.filter(
        (r) => r.childSessionKey === sessionKey || r.childSessionKey.startsWith(`${sessionKey}:`),
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          total: runs.length,
          runs: runs.map((run) => ({
            runId: run.runId,
            childSessionKey: run.childSessionKey,
            task: run.task,
            label: run.label,
            status: run.status,
            outcome: run.outcome,
            reason: run.reason,
            error: run.error,
            spawnedAt: run.spawnedAt,
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
