// JSON-RPC 2.0 base
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ACP Protocol types
export interface AgentInfo {
  name: string;
  description?: string;
}

export interface AgentCapabilities {
  promptCapabilities: PromptCapabilities;
  configOptions?: ConfigOption[];
  modes?: Mode[];
}

export interface PromptCapabilities {
  text: boolean;
  image: boolean;
}

export interface ConfigOption {
  key: string;
  label: string;
  type: "boolean" | "string" | "number" | "enum";
  default?: unknown;
  options?: string[];
}

export interface Mode {
  slug: string;
  name: string;
  description?: string;
}

export interface Session {
  id: string;
  createdAt: string;
}

// Initialize
export interface InitializeParams {
  clientInfo: { name: string; version: string };
}

export interface InitializeResult {
  agentInfo: AgentInfo;
  capabilities: AgentCapabilities;
}

// Session
export interface NewSessionParams {
  cwd?: string;
}

export interface NewSessionResult {
  sessionId: string;
  configOptions?: ConfigOption[];
  modes?: Mode[];
}

export interface LoadSessionParams {
  sessionId: string;
}

export interface LoadSessionResult {
  messages: ContentBlock[][];
}

export interface ListSessionsResult {
  sessions: Session[];
}

// Prompt
export interface PromptParams {
  sessionId: string;
  messages: PromptMessage[];
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "thinking"; text: string; signature?: string };

// Session updates (notifications from agent)
export type SessionUpdate =
  | AgentMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate
  | ToolCallUpdateCompleted
  | ToolCallUpdateFailed
  | PermissionRequestUpdate
  | PromptFinishedUpdate
  | ErrorUpdate;

export interface AgentMessageChunkUpdate {
  type: "agent_message_chunk";
  sessionId: string;
  delta: string;
}

export interface AgentThoughtChunkUpdate {
  type: "agent_thought_chunk";
  sessionId: string;
  delta: string;
}

export interface ToolCallUpdate {
  type: "tool_call";
  sessionId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolCallUpdateCompleted {
  type: "tool_call_update";
  sessionId: string;
  toolCallId: string;
  status: "completed";
  output: string;
}

export interface ToolCallUpdateFailed {
  type: "tool_call_update";
  sessionId: string;
  toolCallId: string;
  status: "failed";
  output: string;
}

export interface PermissionRequestUpdate {
  type: "permission_request";
  sessionId: string;
  id: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface PromptFinishedUpdate {
  type: "prompt_finished";
  sessionId: string;
  stopReason?: string;
}

export interface ErrorUpdate {
  type: "error";
  sessionId: string;
  error: string;
}

// Permission response
export interface RequestPermissionParams {
  id: string;
  approved: boolean;
}

// Cancel
export interface CancelParams {
  sessionId: string;
}
