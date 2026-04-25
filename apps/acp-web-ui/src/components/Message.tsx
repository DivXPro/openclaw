import type { UIMessage } from "ai";
import {
  isTextUIPart,
  isReasoningUIPart,
  isToolUIPart,
} from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock, type ToolCallBlockProps } from "./ToolCallBlock";

interface MessageProps {
  message: UIMessage;
}

export function Message({ message }: MessageProps) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    return (
      <div className="message message-user">
        <div className="message-content">{text}</div>
      </div>
    );
  }

  return (
    <div className="message message-assistant">
      {message.parts.map((part, i) => (
        <MessagePart key={i} part={part} />
      ))}
    </div>
  );
}

function MessagePart({ part }: { part: UIMessage["parts"][number] }) {
  if (isTextUIPart(part)) {
    return (
      <div className="message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {part.text}
        </ReactMarkdown>
      </div>
    );
  }

  if (isReasoningUIPart(part)) {
    return <ThinkingBlock text={part.text} state={part.state} />;
  }

  if (isToolUIPart(part)) {
    // Both ToolUIPart (type `tool-${name}`) and DynamicToolUIPart (type
    // `dynamic-tool`) share the same shape: toolCallId, input, output, state.
    // DynamicToolUIPart exposes toolName directly; for ToolUIPart we derive
    // it from the type string.
    const toolName =
      "toolName" in part
        ? (part as { toolName: string }).toolName
        : part.type.replace(/^tool-/, "");
    const toolPart = part as {
      toolCallId: string;
      state: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };

    return (
      <ToolCallBlock
        toolCallId={toolPart.toolCallId}
        toolName={toolName}
        input={toolPart.input}
        output={toolPart.output}
        errorText={toolPart.errorText}
        state={toolPart.state as ToolCallBlockProps["state"]}
      />
    );
  }

  // Ignore source-url, source-document, file, step-start, data-* parts
  return null;
}
