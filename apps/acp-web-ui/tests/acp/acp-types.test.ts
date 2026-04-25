import { describe, it, expect } from "vitest";
import type {
  SessionUpdate,
  ToolCallUpdateCompleted,
  ToolCallUpdateFailed,
} from "../../src/acp/acp-types";

describe("acp-types", () => {
  it("narrows tool_call_update by status", () => {
    const completed: ToolCallUpdateCompleted = {
      type: "tool_call_update",
      sessionId: "s1",
      toolCallId: "tc1",
      status: "completed",
      output: "done",
    };
    const failed: ToolCallUpdateFailed = {
      type: "tool_call_update",
      sessionId: "s1",
      toolCallId: "tc1",
      status: "failed",
      output: "error",
    };
    expect(completed.status).toBe("completed");
    expect(failed.status).toBe("failed");
  });

  it("narrows SessionUpdate by type", () => {
    const updates: SessionUpdate[] = [
      { type: "agent_message_chunk", sessionId: "s1", delta: "hello" },
      { type: "prompt_finished", sessionId: "s1" },
    ];
    const text = updates.filter(
      (u): u is Extract<SessionUpdate, { type: "agent_message_chunk" }> =>
        u.type === "agent_message_chunk",
    );
    expect(text).toHaveLength(1);
    expect(text[0].delta).toBe("hello");
  });
});
