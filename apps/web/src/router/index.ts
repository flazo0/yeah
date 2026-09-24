import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import LoginPage from "../pages/LoginPage.vue";
import RegisterPage from "../pages/RegisterPage.vue";
import DashboardPage from "../pages/DashboardPage.vue";
import ProjectsPage from "../pages/ProjectsPage.vue";
import ProjectPage from "../pages/ProjectPage.vue";
import EnvironmentPage from "../pages/EnvironmentPage.vue";
import ResourceNewPage from "../pages/ResourceNewPage.vue";
import ServersPage from "../pages/ServersPage.vue";
import ServerNewPage from "../pages/ServerNewPage.vue";
import ServerLayout from "../layouts/ServerLayout.vue";
import ServerGeneralPage from "../pages/server/ServerGeneralPage.vue";
import ServerProxyPage from "../pages/server/ServerProxyPage.vue";
import ServerMetricsPage from "../pages/server/ServerMetricsPage.vue";
import ServerTerminalPage from "../pages/server/ServerTerminalPage.vue";
import StoragesPage from "../pages/StoragesPage.vue";
import SourcesPage from "../pages/SourcesPage.vue";
import SourceDetailPage from "../pages/SourceDetailPage.vue";
import NotificationsPage from "../pages/NotificationsPage.vue";
import UpdatesPage from "../pages/UpdatesPage.vue";
import TeamPage from "../pages/TeamPage.vue";
import VariablesPage from "../pages/VariablesPage.vue";
import SettingsPage from "../pages/SettingsPage.vue";
import ApplicationLayout from "../layouts/ApplicationLayout.vue";
import ApplicationDeploymentsPage from "../pages/application/ApplicationDeploymentsPage.vue";
import ApplicationGeneralPage from "../pages/application/ApplicationGeneralPage.vue";
import ApplicationEnvPage from "../pages/application/ApplicationEnvPage.vue";
import ApplicationStoragePage from "../pages/application/ApplicationStoragePage.vue";
import ApplicationLogsPage from "../pages/application/ApplicationLogsPage.vue";
import ApplicationAdvancedPage from "../pages/application/ApplicationAdvancedPage.vue";
import ApplicationWebhooksPage from "../pages/application/ApplicationWebhooksPage.vue";
import ApplicationDangerPage from "../pages/application/ApplicationDangerPage.vue";
import DatabaseLayout from "../layouts/DatabaseLayout.vue";
import DatabaseBackupsPage from "../pages/database/DatabaseBackupsPage.vue";
import DatabaseGeneralPage from "../pages/database/DatabaseGeneralPage.vue";
import ServiceLayout from "../layouts/ServiceLayout.vue";
import ServiceGeneralPage from "../pages/service/ServiceGeneralPage.vue";
import ServiceEnvPage from "../pages/service/ServiceEnvPage.vue";

// import.meta.env.BASE_URL comes from Vite's own `base` config (set at build time — see
// vite.config.ts) — in production this is the random per-install panel path (see install.sh),
// so the router, the built asset URLs and the api/ws relative paths (lib/api.ts, lib/ws.ts) all
// agree on the same prefix without hardcoding it anywhere.
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/login", component: LoginPage, meta: { guest: true } },
    { path: "/register", component: RegisterPage, meta: { guest: true } },
    { path: "/dashboard", component: DashboardPage, meta: { requiresAuth: true } },
    { path: "/teams/:teamId", component: ProjectsPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/servers", component: ServersPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/servers/new", component: ServerNewPage, meta: { requiresAuth: true }, props: true },
    {
      path: "/teams/:teamId/servers/:serverId",
      component: ServerLayout,
      meta: { requiresAuth: true },
      redirect: (to) => `${to.path}/general`,
      children: [
        { path: "general", name: "server-general", component: ServerGeneralPage },
        { path: "proxy", name: "server-proxy", component: ServerProxyPage },
        { path: "metrics", name: "server-metrics", component: ServerMetricsPage },
        { path: "terminal", name: "server-terminal", component: ServerTerminalPage },
      ],
    },
    { path: "/teams/:teamId/storages", component: StoragesPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/sources", component: SourcesPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/sources/:sourceId", component: SourceDetailPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/github", redirect: (to) => `/teams/${to.params.teamId}/sources` },
    { path: "/teams/:teamId/notifications", component: NotificationsPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/variables", component: VariablesPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/team", component: TeamPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/settings", component: SettingsPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/updates", component: UpdatesPage, meta: { requiresAuth: true }, props: true },
    {
      path: "/teams/:teamId/projects/:projectId",
      component: ProjectPage,
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId",
      component: EnvironmentPage,
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/new",
      component: ResourceNewPage,
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/apps/:applicationId",
      component: ApplicationLayout,
      meta: { requiresAuth: true },
      redirect: (to) => `${to.path}/deployments`,
      children: [
        { path: "deployments", name: "app-deployments", component: ApplicationDeploymentsPage },
        { path: "general", name: "app-general", component: ApplicationGeneralPage },
        { path: "env", name: "app-env", component: ApplicationEnvPage },
        { path: "storage", name: "app-storage", component: ApplicationStoragePage },
        { path: "logs", name: "app-logs", component: ApplicationLogsPage },
        { path: "advanced", name: "app-advanced", component: ApplicationAdvancedPage },
        { path: "webhooks", name: "app-webhooks", component: ApplicationWebhooksPage },
        { path: "danger", name: "app-danger", component: ApplicationDangerPage },
      ],
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/databases/:databaseId",
      component: DatabaseLayout,
      meta: { requiresAuth: true },
      redirect: (to) => `${to.path}/backups`,
      children: [
        { path: "backups", name: "database-backups", component: DatabaseBackupsPage },
        { path: "general", name: "database-general", component: DatabaseGeneralPage },
      ],
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/services/:serviceId",
      component: ServiceLayout,
      meta: { requiresAuth: true },
      redirect: (to) => `${to.path}/general`,
      children: [
        { path: "general", name: "service-general", component: ServiceGeneralPage },
        { path: "env", name: "service-env", component: ServiceEnvPage },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();
  if (!auth.setupChecked) await auth.checkSetup();
  // Single-admin instance: "/register" only works once, before that first account exists —
  // after that it's just "/login" for anyone, including a first-time visitor who'd otherwise
  // land on "/register" by default.
  if (to.path === "/register" && !auth.needsSetup) return "/login";
  if (to.path === "/login" && auth.needsSetup) return "/register";
  if (to.meta.requiresAuth && !auth.user) return auth.needsSetup ? "/register" : "/login";
  if (to.meta.guest && auth.user) return "/dashboard";
  return true;
});
