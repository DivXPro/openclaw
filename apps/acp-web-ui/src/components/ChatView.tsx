import { useAcpChat } from "../hooks/use-acp-chat";
import { useAcpContext } from "../context/acp-context";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { PermissionDialog } from "./PermissionDialog";

export function ChatView() {
  const { connectionState, activeSessionId } = useAcpContext();
  const { messages, sendMessage, status, handlePermissionResponse } =
    useAcpChat();

  if (connectionState !== "connected" || !activeSessionId) {
    return (
      <div className="chat-view-empty">
        <p>Connect and select a session to start chatting</p>
      </div>
    );
  }

  return (
    <div className="chat-view">
      <MessageList messages={messages} />
      <PermissionDialog messages={messages} onRespond={handlePermissionResponse} />
      <ChatInput onSend={sendMessage} disabled={status === "streaming"} />
    </div>
  );
}
