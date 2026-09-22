import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import LoginPage from "../pages/LoginPage.vue";
import RegisterPage from "../pages/RegisterPage.vue";
import DashboardPage from "../pages/DashboardPage.vue";
import ProjectsPage from "../pages/ProjectsPage.vue";
import ProjectPage from "../pages/ProjectPage.vue";
import EnvironmentPage from "../pages/EnvironmentPage.vue";
import ServersPage from "../pages/ServersPage.vue";
import StoragesPage from "../pages/StoragesPage.vue";
import GithubPage from "../pages/GithubPage.vue";
import NotificationsPage from "../pages/NotificationsPage.vue";
import UpdatesPage from "../pages/UpdatesPage.vue";
import ApplicationLayout from "../layouts/ApplicationLayout.vue";
import ApplicationDeploymentsPage from "../pages/application/ApplicationDeploymentsPage.vue";
import ApplicationGeneralPage from "../pages/application/ApplicationGeneralPage.vue";
import ApplicationEnvPage from "../pages/application/ApplicationEnvPage.vue";
import ApplicationStoragePage from "../pages/application/ApplicationStoragePage.vue";
import DatabaseDetailPage from "../pages/DatabaseDetailPage.vue";
import ServiceDetailPage from "../pages/ServiceDetailPage.vue";

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
    { path: "/teams/:teamId/storages", component: StoragesPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/github", component: GithubPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/notifications", component: NotificationsPage, meta: { requiresAuth: true }, props: true },
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
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/apps/:applicationId",
      component: ApplicationLayout,
      meta: { requiresAuth: true },
      redirect: (to) => `${to.path}/deployments`,
      children: [
        { path: "deployments", name: "app-deployments", component: ApplicationDeploymentsPage },
        { path: "general", name: "app-general", component: ApplicationGeneralPage },
        { path: "env", name: "app-env", component: ApplicationEnvPage },
        { path: "storage", name: "app-storage", component: ApplicationStoragePage },
      ],
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/databases/:databaseId",
      component: DatabaseDetailPage,
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/services/:serviceId",
      component: ServiceDetailPage,
      meta: { requiresAuth: true },
      props: true,
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
