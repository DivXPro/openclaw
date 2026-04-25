import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { AcpWsClient } from "../acp/acp-ws-client";
import type {
  InitializeResult,
  Session,
  AgentCapabilities,
} from "../acp/acp-types";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface AcpContextValue {
  client: AcpWsClient | null;
  connectionState: ConnectionState;
  sessions: Session[];
  activeSessionId: string | null;
  capabilities: AgentCapabilities | null;
  connect: (url: string) => Promise<void>;
  disconnect: () => void;
  setActiveSessionId: (id: string | null) => void;
  refreshSessions: () => Promise<void>;
}

const AcpContext = createContext<AcpContextValue | null>(null);

export function useAcpContext(): AcpContextValue {
  const ctx = useContext(AcpContext);
  if (!ctx) throw new Error("useAcpContext must be used within AcpProvider");
  return ctx;
}

interface AcpProviderProps {
  children: ReactNode;
  defaultUrl?: string;
}

export function AcpProvider({ children, defaultUrl }: AcpProviderProps) {
  const [client, setClient] = useState<AcpWsClient | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(
    null,
  );

  const connect = useCallback(async (url: string) => {
    setConnectionState("connecting");
    const wsClient = new AcpWsClient();

    wsClient.onClose(() => {
      setConnectionState("disconnected");
      setClient(null);
      setCapabilities(null);
    });

    wsClient.onError(() => {
      setConnectionState("disconnected");
      setClient(null);
    });

    try {
      const result: InitializeResult = await wsClient.connect(url);
      setClient(wsClient);
      setCapabilities(result.capabilities);
      setConnectionState("connected");
    } catch (err) {
      setConnectionState("disconnected");
      throw err;
    }
  }, []);

  const disconnect = useCallback(() => {
    client?.disconnect();
    setClient(null);
    setConnectionState("disconnected");
    setCapabilities(null);
    setSessions([]);
    setActiveSessionId(null);
  }, [client]);

  const refreshSessions = useCallback(async () => {
    if (!client) return;
    try {
      const result = await client.listSessions();
      setSessions(result.sessions);
    } catch {
      // ignore — sessions may not be supported
    }
  }, [client]);

  // Auto-connect if defaultUrl provided
  useEffect(() => {
    if (defaultUrl && connectionState === "disconnected") {
      connect(defaultUrl).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  return (
    <AcpContext.Provider
      value={{
        client,
        connectionState,
        sessions,
        activeSessionId,
        capabilities,
        connect,
        disconnect,
        setActiveSessionId,
        refreshSessions,
      }}
    >
      {children}
    </AcpContext.Provider>
  );
}
