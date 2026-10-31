import { inject, type Ref } from "vue";
import type { ApplicationDto, DeploymentDto } from "@yeah/shared";

export interface ApplicationContext {
  app: Ref<ApplicationDto | null>;
  basePath: string;
  environmentPath: string;
  error: Ref<string>;
  reloadApp: () => Promise<void>;
  /** Set by the header's Deploy button on every successful trigger — the deployments page
   * watches it to pick up a new deploy without a remount when the user is already on that page. */
  lastDeployment: Ref<DeploymentDto | null>;
}

export const APPLICATION_CONTEXT_KEY = "application-context";

export function useApplicationContext(): ApplicationContext {
  const context = inject<ApplicationContext>(APPLICATION_CONTEXT_KEY);
  if (!context) throw new Error("useApplicationContext() called outside ApplicationLayout's router-view");
  return context;
}
