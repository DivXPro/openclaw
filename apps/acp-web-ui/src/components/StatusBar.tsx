import { useAcpContext } from "../context/acp-context";

export function StatusBar() {
  const { connectionState, capabilities, connect, disconnect } = useAcpContext();

  return (
    <div className="status-bar">
      <span className={`status-indicator ${connectionState}`} />
      <span className="status-text">
        {connectionState === "connected" ? "Connected" : connectionState === "connecting" ? "Connecting..." : "Disconnected"}
      </span>
      {capabilities && (
        <span className="agent-info">
          {capabilities.promptCapabilities?.text && "Text"}{capabilities.promptCapabilities?.image && " + Image"}
        </span>
      )}
      <div className="status-actions">
        {connectionState === "disconnected" && (
          <button onClick={() => connect("ws://localhost:3100")}>Connect</button>
        )}
        {connectionState === "connected" && (
          <button onClick={disconnect}>Disconnect</button>
        )}
      </div>
    </div>
  );
}
