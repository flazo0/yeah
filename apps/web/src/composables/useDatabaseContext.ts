import { inject, type Ref } from "vue";
import type { DatabaseDto } from "@yeah/shared";

export interface DatabaseContext {
  database: Ref<DatabaseDto | null>;
  basePath: string;
  environmentPath: string;
  error: Ref<string>;
  reloadDatabase: () => Promise<void>;
}

export const DATABASE_CONTEXT_KEY = "database-context";

export function useDatabaseContext(): DatabaseContext {
  const context = inject<DatabaseContext>(DATABASE_CONTEXT_KEY);
  if (!context) throw new Error("useDatabaseContext() called outside DatabaseLayout's router-view");
  return context;
}
