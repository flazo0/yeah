import { inject, type Ref } from "vue";
import type { ServerDto } from "@yeah/shared";

export interface ServerContext {
  server: Ref<ServerDto | null>;
  teamId: string;
  error: Ref<string>;
  replaceServer: (server: ServerDto) => void;
}

export const SERVER_CONTEXT_KEY = "server-context";

export function useServerContext(): ServerContext {
  const context = inject<ServerContext>(SERVER_CONTEXT_KEY);
  if (!context) throw new Error("useServerContext() called outside ServerLayout's router-view");
  return context;
}
