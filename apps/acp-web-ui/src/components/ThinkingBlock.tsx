import { useState } from "react";

interface ThinkingBlockProps {
  text: string;
  state?: "streaming" | "done";
}

export function ThinkingBlock({ text, state }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="thinking-block">
      <button
        className="thinking-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "▼" : "▶"} Thinking
        {state === "streaming" ? "..." : ""}
      </button>
      {expanded && <pre className="thinking-content">{text}</pre>}
    </div>
  );
}
