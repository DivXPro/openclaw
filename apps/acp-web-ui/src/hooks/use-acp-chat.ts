import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef } from "react";
import { AcpChatTransport } from "../acp/acp-chat-transport";
import { useAcpContext } from "../context/acp-context";

/**
 * Hook that wraps AI SDK's useChat with the ACP transport.
 *
 * Manages session-aware transport creation and exposes a sendMessage
 * helper plus permission-response handling for the ACP protocol.
 */
export function useAcpChat() {
  const { client, activeSessionId } = useAcpContext();
  const transportRef = useRef<AcpChatTransport | null>(null);

  // Create transport when client and session are available
  useEffect(() => {
    if (client && activeSessionId) {
      transportRef.current = new AcpChatTransport({
        wsClient: client,
        sessionId: activeSessionId,
      });
    } else {
      transportRef.current = null;
    }
  }, [client, activeSessionId]);

  // AcpChatTransport imports types from the root `ai@6` package while
  // @ai-sdk/react bundles `ai@5`. The transport is structurally
  // compatible (it never sets providerMetadata), but TypeScript cannot
  // reconcile the different package versions. Cast through unknown.
  const chat = useChat({
    transport: transportRef.current as unknown as
      | Parameters<typeof useChat>[0] extends infer O
        ? O extends { transport?: infer T }
          ? T
          : never
        : never,
  });

  // Send a user message through the ACP prompt flow
  const sendMessage = useCallback(
    async (text: string) => {
      if (!client || !activeSessionId || !transportRef.current) return;
      await chat.sendMessage({ text });
    },
    [client, activeSessionId, chat],
  );

  // Respond to a permission/approval request from the agent
  const handlePermissionResponse = useCallback(
    async (approvalId: string, approved: boolean) => {
      if (!client) return;
      await client.respondPermission(approvalId, approved);
    },
    [client],
  );

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    sendMessage,
    stop: chat.stop,
    regenerate: chat.regenerate,
    clearError: chat.clearError,
    addToolOutput: chat.addToolOutput,
    handlePermissionResponse,
    isReady: !!(client && activeSessionId && transportRef.current),
  };
}

export type UseAcpChatReturn = ReturnType<typeof useAcpChat>;
