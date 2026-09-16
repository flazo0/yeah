import type { WsServerEvent } from "@yeah/shared";

type Listener = (event: WsServerEvent) => void;

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001";

class WsClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();

  private connect() {
    if (this.socket) return;
    const socket = new WebSocket(WS_URL);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsServerEvent;
        for (const listener of this.listeners) listener(data);
      } catch {
        // ignore malformed payloads
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
    };
    this.socket = socket;
  }

  /** Registers a listener and returns an unsubscribe function. */
  on(listener: Listener): () => void {
    this.connect();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const wsClient = new WsClient();
