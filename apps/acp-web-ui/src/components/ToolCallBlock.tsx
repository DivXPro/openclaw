import { useState } from "react";

export type ToolCallState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export interface ToolCallBlockProps {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
  state: ToolCallState;
}

export function ToolCallBlock({
  toolName,
  input,
  output,
  errorText,
  state,
}: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const stateLabel = (() => {
    switch (state) {
      case "input-streaming":
        return " (streaming...)";
      case "input-available":
        return " (running...)";
      case "approval-requested":
        return " (awaiting approval)";
      case "approval-responded":
        return " (approved)";
      case "output-available":
        return " (done)";
      case "output-error":
        return " (error)";
      case "output-denied":
        return " (denied)";
    }
  })();

  return (
    <div className="tool-call-block">
      <button
        className="tool-call-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "▼" : "▶"} {toolName}
        {stateLabel}
      </button>
      {expanded && (
        <div className="tool-call-details">
          <div className="tool-call-input">
            <strong>Input:</strong>
            <pre>{JSON.stringify(input, null, 2)}</pre>
          </div>
          {output !== undefined && (
            <div className="tool-call-output">
              <strong>Output:</strong>
              <pre>{JSON.stringify(output, null, 2)}</pre>
            </div>
          )}
          {errorText && (
            <div className="tool-call-error">
              <strong>Error:</strong> {errorText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
