import { useState } from "react";
import { useAcpContext } from "../context/acp-context";

export function ModeSelector() {
  const { client, capabilities, activeSessionId } = useAcpContext();
  const [selectedMode, setSelectedMode] = useState<string | null>(null);

  if (!capabilities?.modes?.length) return null;

  const handleModeChange = async (mode: string) => {
    if (!client || !activeSessionId) return;
    await client.setMode(activeSessionId, mode);
    setSelectedMode(mode);
  };

  return (
    <div className="mode-selector">
      {capabilities.modes.map((mode) => (
        <button
          key={mode.slug}
          className={`mode-btn ${selectedMode === mode.slug ? "active" : ""}`}
          onClick={() => handleModeChange(mode.slug)}
          title={mode.description}
        >
          {mode.name}
        </button>
      ))}
    </div>
  );
}
