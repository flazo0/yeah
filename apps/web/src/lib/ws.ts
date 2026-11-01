import type { WsServerEvent } from "@yeah/shared";

type Listener = (event: WsServerEvent) => void;

// Empty (production default) means "same origin as the page, under the app's own base path" —
// reverse-proxied by nginx to the ws container (see apps/web/nginx.conf and lib/api.ts for the
// matching /api case). Local dev sets VITE_WS_URL explicitly since there's no proxy there.
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${import.meta.env.BASE_URL}ws`;

class WsClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();

  private retryDelay = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  // The socket is authenticated by the session cookie (sent automatically, same site). The server
  // refuses the upgrade without a valid session and closes sockets whose session ends, so we retry
  // with a capped backoff for as long as something is listening.
  private connect() {
    if (this.socket) return;
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      this.retryDelay = 1000;
    };
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
      if (this.listeners.size === 0 || this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (this.listeners.size > 0) this.connect();
      }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
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
