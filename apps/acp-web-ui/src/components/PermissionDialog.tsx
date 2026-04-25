import { useState, useEffect } from "react";
import type { UIMessage } from "ai";

interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface PermissionDialogProps {
  messages: UIMessage[];
  onRespond: (approvalId: string, approved: boolean) => void | Promise<void>;
}

/**
 * Scans UIMessage parts for tool invocations in the `approval-requested` state
 * and presents a modal dialog for the user to allow or deny each one.
 *
 * AI SDK v6 tool parts (both `tool-${name}` and `dynamic-tool`) transition
 * through states: input-streaming -> input-available -> approval-requested ->
 * approval-responded -> output-available / output-error / output-denied.
 *
 * When `state === 'approval-requested'`, the part carries an `approval.id`
 * that the transport uses to route the response back to the agent.
 */
export function PermissionDialog({ messages, onRespond }: PermissionDialogProps) {
  const [pending, setPending] = useState<PendingApproval[]>([]);

  useEffect(() => {
    const approvals: PendingApproval[] = [];

    for (const msg of messages) {
      if (!msg.parts) continue;
      for (const part of msg.parts) {
        // Check for tool parts in approval-requested state
        if (
          (part.type === "dynamic-tool" ||
            (typeof part.type === "string" && part.type.startsWith("tool-"))) &&
          "state" in part &&
          (part as { state: string }).state === "approval-requested"
        ) {
          const toolPart = part as {
            toolCallId: string;
            state: string;
            input?: unknown;
            approval: { id: string };
          } & (
            | { toolName: string }
            | { type: string }
          );

          const toolName =
            "toolName" in toolPart
              ? toolPart.toolName
              : toolPart.type.replace(/^tool-/, "");

          approvals.push({
            approvalId: toolPart.approval.id,
            toolCallId: toolPart.toolCallId,
            toolName,
            args: toolPart.input,
          });
        }
      }
    }

    setPending(approvals);
  }, [messages]);

  if (pending.length === 0) return null;

  const current = pending[0];

  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <h3>Permission Request</h3>
        <p>
          <strong>{current.toolName}</strong> wants to run
        </p>
        <pre className="permission-args">
          {JSON.stringify(current.args, null, 2)}
        </pre>
        <div className="permission-actions">
          <button
            className="permission-allow"
            onClick={() => onRespond(current.approvalId, true)}
          >
            Allow
          </button>
          <button
            className="permission-deny"
            onClick={() => onRespond(current.approvalId, false)}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
