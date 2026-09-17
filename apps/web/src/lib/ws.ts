import type { WsServerEvent } from "@yeah/shared";

type Listener = (event: WsServerEvent) => void;

// Empty (production default) means "same origin as the page, over /ws" — reverse-proxied by
// nginx (see apps/web/nginx.conf). Local dev sets VITE_WS_URL explicitly since there's no proxy.
const WS_URL =
  import.meta.env.VITE_WS_URL || `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

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
