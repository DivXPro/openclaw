import type { ChatTransport, FinishReason, UIMessage, UIMessageChunk } from "ai";
import type { AcpWsClient } from "./acp-ws-client";
import type { SessionUpdate } from "./acp-types";

export interface AcpChatTransportOptions {
  wsClient: AcpWsClient;
  sessionId: string;
}

export class AcpChatTransport
  implements ChatTransport<UIMessage>
{
  private wsClient: AcpWsClient;
  private sessionId: string;

  constructor(options: AcpChatTransportOptions) {
    this.wsClient = options.wsClient;
    this.sessionId = options.sessionId;
  }

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    // Extract text from the latest user message's parts
    const lastMessage = messages[messages.length - 1];
    let promptText = "";
    if (lastMessage && "parts" in lastMessage) {
      const textPart = (lastMessage.parts as Array<{ type: string; text?: string }>).find(
        (p) => p.type === "text",
      );
      if (textPart && "text" in textPart) {
        promptText = textPart.text ?? "";
      }
    }

    const acpMessages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: promptText }],
      },
    ];

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        let closed = false;

        const close = () => {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        };

        const unsubscribe = this.wsClient.onSessionUpdate(
          (update: SessionUpdate) => {
            if (update.sessionId !== this.sessionId) return;

            const chunks = this.toChunks(update);
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }

            if (update.type === "prompt_finished" || update.type === "error") {
              close();
              unsubscribe();
            }
          },
        );

        // Handle abort
        if (abortSignal) {
          const onAbort = () => {
            this.wsClient.cancel(this.sessionId).catch(() => {});
            close();
            unsubscribe();
            abortSignal.removeEventListener("abort", onAbort);
          };

          if (abortSignal.aborted) {
            onAbort();
            return;
          }

          abortSignal.addEventListener("abort", onAbort);
        }

        try {
          await this.wsClient.prompt(this.sessionId, acpMessages);
        } catch (err) {
          controller.enqueue({
            type: "error",
            errorText: err instanceof Error ? err.message : String(err),
          });
          close();
          unsubscribe();
        }
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null; // ACP does not support stream reconnection
  }

  private toChunks(update: SessionUpdate): UIMessageChunk[] {
    switch (update.type) {
      case "agent_message_chunk":
        return [
          {
            type: "text-delta",
            id: crypto.randomUUID(),
            delta: update.delta,
          },
        ];
      case "agent_thought_chunk":
        return [
          {
            type: "reasoning-delta",
            id: crypto.randomUUID(),
            delta: update.delta,
          },
        ];
      case "tool_call":
        return [
          {
            type: "tool-input-available",
            toolCallId: update.toolCallId,
            toolName: update.toolName,
            input: update.input,
          },
        ];
      case "tool_call_update":
        return [
          {
            type: "tool-output-available",
            toolCallId: update.toolCallId,
            output: update.output,
          },
        ];
      case "permission_request":
        return [
          {
            type: "tool-approval-request",
            approvalId: update.id,
            toolCallId: update.toolCallId,
          },
        ];
      case "prompt_finished":
        return [
          {
            type: "finish",
            finishReason: toFinishReason(update.stopReason),
          },
        ];
      case "error":
        return [{ type: "error", errorText: update.error }];
    }
  }
}

const VALID_FINISH_REASONS = new Set<FinishReason>([
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "error",
  "other",
]);

function toFinishReason(reason: string | undefined): FinishReason {
  if (reason && VALID_FINISH_REASONS.has(reason as FinishReason)) {
    return reason as FinishReason;
  }
  return "stop";
}
