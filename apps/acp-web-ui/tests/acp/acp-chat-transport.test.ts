import { describe, it, expect, vi, beforeEach } from "vitest";
import { AcpChatTransport } from "../../src/acp/acp-chat-transport";
import type { AcpWsClient } from "../../src/acp/acp-ws-client";
import type { SessionUpdate } from "../../src/acp/acp-types";
import type { UIMessageChunk } from "ai";

function createMockWsClient() {
  const handlers: Array<(u: SessionUpdate) => void> = [];
  return {
    onSessionUpdate: vi.fn((h: (u: SessionUpdate) => void) => {
      handlers.push(h);
      return () => {
        const idx = handlers.indexOf(h);
        if (idx !== -1) handlers.splice(idx, 1);
      };
    }),
    prompt: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    _emitUpdate: (u: SessionUpdate) => {
      for (const h of handlers) h(u);
    },
  };
}

type MockWsClient = ReturnType<typeof createMockWsClient>;

function makeUserMessage(text: string) {
  return {
    id: "msg-1",
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
}

async function collectChunks(
  stream: ReadableStream<UIMessageChunk>,
): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe("AcpChatTransport", () => {
  let mockClient: MockWsClient;

  beforeEach(() => {
    mockClient = createMockWsClient();
  });

  it("converts agent_message_chunk to text-delta", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "agent_message_chunk",
      sessionId: "s1",
      delta: "Hello",
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("text-delta");
    if (chunks[0].type === "text-delta") {
      expect(chunks[0].delta).toBe("Hello");
      expect(chunks[0].id).toBeDefined();
    }
  });

  it("converts agent_thought_chunk to reasoning-delta", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("think")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "agent_thought_chunk",
      sessionId: "s1",
      delta: "thinking...",
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("reasoning-delta");
    if (chunks[0].type === "reasoning-delta") {
      expect(chunks[0].delta).toBe("thinking...");
      expect(chunks[0].id).toBeDefined();
    }
  });

  it("converts tool_call to tool-input-available", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "tool_call",
      sessionId: "s1",
      toolCallId: "tc1",
      toolName: "read_file",
      input: { path: "/tmp" },
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("tool-input-available");
    if (chunks[0].type === "tool-input-available") {
      expect(chunks[0].toolCallId).toBe("tc1");
      expect(chunks[0].toolName).toBe("read_file");
      expect(chunks[0].input).toEqual({ path: "/tmp" });
    }
  });

  it("converts tool_call_update (completed) to tool-output-available", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "tool_call_update",
      sessionId: "s1",
      toolCallId: "tc1",
      status: "completed",
      output: "file contents",
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("tool-output-available");
    if (chunks[0].type === "tool-output-available") {
      expect(chunks[0].toolCallId).toBe("tc1");
      expect(chunks[0].output).toBe("file contents");
    }
  });

  it("converts tool_call_update (failed) to tool-output-available with error", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "tool_call_update",
      sessionId: "s1",
      toolCallId: "tc1",
      status: "failed",
      output: "permission denied",
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("tool-output-available");
    if (chunks[0].type === "tool-output-available") {
      expect(chunks[0].toolCallId).toBe("tc1");
      expect(chunks[0].output).toBe("permission denied");
    }
  });

  it("converts permission_request to tool-approval-request", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "permission_request",
      sessionId: "s1",
      id: "pr1",
      toolCallId: "tc1",
      toolName: "write_file",
      input: { path: "/tmp" },
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("tool-approval-request");
    if (chunks[0].type === "tool-approval-request") {
      expect(chunks[0].approvalId).toBe("pr1");
      expect(chunks[0].toolCallId).toBe("tc1");
    }
  });

  it("converts prompt_finished to finish chunk", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
      stopReason: "stop",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("finish");
    if (chunks[0].type === "finish") {
      expect(chunks[0].finishReason).toBe("stop");
    }
  });

  it("converts error update to error chunk", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "error",
      sessionId: "s1",
      error: "something went wrong",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    if (chunks[0].type === "error") {
      expect(chunks[0].errorText).toBe("something went wrong");
    }
  });

  it("ignores updates for other sessions", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    // Update for a different session - should be ignored
    mockClient._emitUpdate({
      type: "agent_message_chunk",
      sessionId: "s2",
      delta: "other session",
    });
    mockClient._emitUpdate({
      type: "agent_message_chunk",
      sessionId: "s1",
      delta: "right session",
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].type).toBe("text-delta");
    if (chunks[0].type === "text-delta") {
      expect(chunks[0].delta).toBe("right session");
    }
  });

  it("sends prompt with extracted text from user message parts", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello world")],
      abortSignal: undefined,
    });

    expect(mockClient.prompt).toHaveBeenCalledWith(
      "s1",
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    );
  });

  it("emits error chunk when prompt call fails", async () => {
    mockClient.prompt = vi.fn().mockRejectedValue(new Error("prompt failed"));

    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    if (chunks[0].type === "error") {
      expect(chunks[0].errorText).toBe("prompt failed");
    }
  });

  it("closes stream and cancels on abort signal", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const controller = new AbortController();
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: controller.signal,
    });

    // Abort immediately
    controller.abort();

    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(mockClient.cancel).toHaveBeenCalledWith("s1");
  });

  it("returns null from reconnectToStream", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const result = await transport.reconnectToStream({
      chatId: "chat-1",
    });
    expect(result).toBeNull();
  });

  it("emits finish with stopReason defaulting to stop", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    // prompt_finished without stopReason
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("finish");
    if (chunks[0].type === "finish") {
      expect(chunks[0].finishReason).toBe("stop");
    }
  });

  it("handles multiple text deltas in sequence", async () => {
    const transport = new AcpChatTransport({
      wsClient: mockClient as unknown as AcpWsClient,
      sessionId: "s1",
    });

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [makeUserMessage("hello")],
      abortSignal: undefined,
    });

    mockClient._emitUpdate({
      type: "agent_message_chunk",
      sessionId: "s1",
      delta: "Hello",
    });
    mockClient._emitUpdate({
      type: "agent_message_chunk",
      sessionId: "s1",
      delta: " world",
    });
    mockClient._emitUpdate({
      type: "agent_message_chunk",
      sessionId: "s1",
      delta: "!",
    });
    mockClient._emitUpdate({
      type: "prompt_finished",
      sessionId: "s1",
    });

    const chunks = await collectChunks(stream);
    expect(chunks).toHaveLength(4);
    const deltas = chunks
      .filter((c): c is Extract<UIMessageChunk, { type: "text-delta" }> => c.type === "text-delta")
      .map((c) => c.delta);
    expect(deltas).toEqual(["Hello", " world", "!"]);
  });
});
