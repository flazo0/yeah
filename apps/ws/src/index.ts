import type { ServerWebSocket } from "bun";
import { createRedisConnection, subscribeServerEvents } from "@yeah/queue";
import type { WsServerEvent } from "@yeah/shared";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}
const port = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3001;

// Phase 0: every connected client sees every event, filtered client-side by id.
// Room-scoped topics (per team/server/deployment) land once auth reaches this service.
const clients = new Set<ServerWebSocket<unknown>>();

const server = Bun.serve({
  port,
  fetch(req, srv) {
    if (srv.upgrade(req)) return;
    return new Response("yeah ws service", { status: 200 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    },
    message() {
      // reserved for future topic subscription messages from the client
    },
  },
});

function broadcast(event: WsServerEvent) {
  const payload = JSON.stringify(event);
  for (const client of clients) client.send(payload);
}

const subscriber = createRedisConnection(redisUrl);
subscribeServerEvents(subscriber, broadcast);

console.log(`[ws] listening on ws://localhost:${server.port}`);
