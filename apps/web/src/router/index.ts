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
import ApplicationDetailPage from "../pages/ApplicationDetailPage.vue";
import DatabaseDetailPage from "../pages/DatabaseDetailPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/login", component: LoginPage, meta: { guest: true } },
    { path: "/register", component: RegisterPage, meta: { guest: true } },
    { path: "/dashboard", component: DashboardPage, meta: { requiresAuth: true } },
    { path: "/teams/:teamId", component: ProjectsPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/servers", component: ServersPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/storages", component: StoragesPage, meta: { requiresAuth: true }, props: true },
    { path: "/teams/:teamId/github", component: GithubPage, meta: { requiresAuth: true }, props: true },
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
      component: ApplicationDetailPage,
      meta: { requiresAuth: true },
      props: true,
    },
    {
      path: "/teams/:teamId/projects/:projectId/environments/:environmentId/databases/:databaseId",
      component: DatabaseDetailPage,
      meta: { requiresAuth: true },
      props: true,
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();
  if (to.meta.requiresAuth && !auth.user) return "/login";
  if (to.meta.guest && auth.user) return "/dashboard";
  return true;
});
