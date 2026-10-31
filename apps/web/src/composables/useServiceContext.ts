import { inject, type Ref } from "vue";
import type { ServiceDto } from "@yeah/shared";

export interface ServiceContext {
  service: Ref<ServiceDto | null>;
  basePath: string;
  environmentPath: string;
  error: Ref<string>;
  reloadService: () => Promise<void>;
}

export const SERVICE_CONTEXT_KEY = "service-context";

export function useServiceContext(): ServiceContext {
  const context = inject<ServiceContext>(SERVICE_CONTEXT_KEY);
  if (!context) throw new Error("useServiceContext() called outside ServiceLayout's router-view");
  return context;
}
