import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  InitializeResult,
  InitializeParams,
  NewSessionParams,
  NewSessionResult,
  LoadSessionParams,
  LoadSessionResult,
  ListSessionsResult,
  PromptParams,
  PromptMessage,
  SessionUpdate,
  RequestPermissionParams,
  CancelParams,
} from "./acp-types";

const DEFAULT_TIMEOUT_MS = 30_000;
const PROMPT_TIMEOUT_MS = 0; // no timeout for prompt

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class AcpWsClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private sessionUpdateHandlers = new Set<(update: SessionUpdate) => void>();
  private closeHandlers = new Set<() => void>();
  private errorHandlers = new Set<(error: Error) => void>();
  private _capabilities: InitializeResult | null = null;

  get capabilities(): InitializeResult | null {
    return this._capabilities;
  }

  async connect(url: string): Promise<InitializeResult> {
    const ws = new WebSocket(url);
    this.ws = ws;

    const openPromise = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (ev) => reject(new Error("WebSocket connection failed")), { once: true });
    });

    ws.addEventListener("message", (ev) => this.handleMessage(ev));

    ws.addEventListener("close", () => {
      this.handleClose();
    });

    ws.addEventListener("error", (ev) => {
      for (const handler of this.errorHandlers) {
        handler(new Error("WebSocket error"));
      }
    });

    await openPromise;
    const result = await this.sendRequest<InitializeResult>("initialize", {
      clientInfo: { name: "acp-web-ui", version: "0.1.0" },
    } satisfies InitializeParams);

    this._capabilities = result;
    return result;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.rejectAllPending("Disconnected");
  }

  newSession(params: NewSessionParams): Promise<NewSessionResult> {
    return this.sendRequest<NewSessionResult>("newSession", params);
  }

  loadSession(params: LoadSessionParams): Promise<LoadSessionResult> {
    return this.sendRequest<LoadSessionResult>("loadSession", params);
  }

  listSessions(): Promise<ListSessionsResult> {
    return this.sendRequest<ListSessionsResult>("listSessions");
  }

  prompt(sessionId: string, messages: PromptMessage[]): Promise<void> {
    const params: PromptParams = { sessionId, messages };
    return this.sendRequest<void>("prompt", params, PROMPT_TIMEOUT_MS);
  }

  cancel(sessionId: string): Promise<void> {
    const params: CancelParams = { sessionId };
    return this.sendRequest<void>("cancel", params);
  }

  respondPermission(id: string, approved: boolean): Promise<void> {
    const params: RequestPermissionParams = { id, approved };
    return this.sendRequest<void>("requestPermission", params);
  }

  onSessionUpdate(handler: (update: SessionUpdate) => void): () => void {
    this.sessionUpdateHandlers.add(handler);
    return () => {
      this.sessionUpdateHandlers.delete(handler);
    };
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  private sendRequest<T>(
    method: string,
    params?: unknown,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method };
      if (params !== undefined) {
        request.params = params;
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Request timed out: ${method} (id=${id})`));
        }, timeoutMs);
      }

      this.pending.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          resolve(value as T);
        },
        reject: (reason) => {
          if (timer) clearTimeout(timer);
          this.pending.delete(id);
          reject(reason);
        },
        timer,
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  private handleMessage(ev: MessageEvent): void {
    let data: unknown;
    try {
      data = JSON.parse(ev.data as string);
    } catch {
      return;
    }

    if (this.isJsonRpcResponse(data)) {
      const pending = this.pending.get(data.id);
      if (pending) {
        if (data.error) {
          pending.reject(
            new Error(
              `JSON-RPC error ${data.error.code}: ${data.error.message}`,
            ),
          );
        } else {
          pending.resolve(data.result);
        }
      }
    } else if (this.isJsonRpcNotification(data)) {
      if (data.method === "sessionUpdate" && data.params) {
        const update = data.params as SessionUpdate;
        for (const handler of this.sessionUpdateHandlers) {
          handler(update);
        }
      }
    }
  }

  private handleClose(): void {
    this.rejectAllPending("WebSocket closed");
    for (const handler of this.closeHandlers) {
      handler();
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private isJsonRpcResponse(data: unknown): data is JsonRpcResponse {
    return (
      typeof data === "object" &&
      data !== null &&
      "jsonrpc" in data &&
      "id" in data &&
      typeof (data as JsonRpcResponse).id === "number"
    );
  }

  private isJsonRpcNotification(
    data: unknown,
  ): data is JsonRpcNotification {
    return (
      typeof data === "object" &&
      data !== null &&
      "jsonrpc" in data &&
      "method" in data &&
      !("id" in data)
    );
  }
}
