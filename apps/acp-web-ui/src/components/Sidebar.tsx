import { useAcpContext } from "../context/acp-context";

export function Sidebar() {
  const { sessions, activeSessionId, setActiveSessionId, client, refreshSessions } = useAcpContext();

  const handleNewSession = async () => {
    if (!client) return;
    const result = await client.newSession({});
    await refreshSessions();
    setActiveSessionId(result.sessionId);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Sessions</h2>
        <button onClick={handleNewSession} disabled={!client}>+ New</button>
      </div>
      <div className="session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? "active" : ""}`}
            onClick={() => setActiveSessionId(session.id)}
          >
            {session.id}
          </button>
        ))}
      </div>
    </div>
  );
}
