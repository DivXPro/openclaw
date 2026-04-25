import { AcpProvider } from "./context/acp-context";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { StatusBar } from "./components/StatusBar";
import { ModeSelector } from "./components/ModeSelector";

export function App() {
  return (
    <AcpProvider defaultUrl="ws://localhost:3100">
      <Sidebar />
      <main className="main-content">
        <ModeSelector />
        <ChatView />
      </main>
      <StatusBar />
    </AcpProvider>
  );
}
