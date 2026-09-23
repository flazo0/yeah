<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { isDark, toggleTheme } from "./lib/theme";
import Logo from "./components/Logo.vue";
import AccountMenu from "./components/AccountMenu.vue";
import TeamSwitcher from "./components/TeamSwitcher.vue";

const auth = useAuthStore();
const route = useRoute();

const sidebarOpen = ref(false);
watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false;
  },
);

const teamId = computed(() => (typeof route.params.teamId === "string" ? route.params.teamId : null));
// The topbar switcher needs a team to show even on /dashboard, which has no :teamId in its URL —
// falls back to the user's first (for single-admin, only) team.
const currentTeamName = computed(() => {
  const team = teamId.value ? auth.teams.find((t) => t.id === teamId.value) : auth.teams[0];
  return team?.name ?? "Time";
});
const projectId = computed(() => (typeof route.params.projectId === "string" ? route.params.projectId : null));
const environmentId = computed(() =>
  typeof route.params.environmentId === "string" ? route.params.environmentId : null,
);

const isProjectsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}`);
const isServersRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/servers`);
const isStoragesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/storages`);
const isGithubRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/github`);
const isNotificationsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/notifications`);
const isUpdatesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/updates`);

// Rendered after the TeamSwitcher segment — just the section trail, the team name itself is the
// switcher now, not a plain string in this list.
const breadcrumb = computed(() => {
  if (!teamId.value) return [];
  if (isServersRoute.value) return ["Servidores"];
  if (isStoragesRoute.value) return ["Armazenamento"];
  if (isGithubRoute.value) return ["GitHub"];
  if (isNotificationsRoute.value) return ["Notificações"];
  if (isUpdatesRoute.value) return ["Atualizações"];
  if (!projectId.value) return ["Projetos"];
  if (!environmentId.value) return ["Projetos", "Ambientes"];
  if (route.params.applicationId) return ["Projetos", "Ambiente", "Aplicação"];
  if (route.params.databaseId) return ["Projetos", "Ambiente", "Banco de dados"];
  if (route.params.serviceId) return ["Projetos", "Ambiente", "Serviço"];
  return ["Projetos", "Recursos"];
});
</script>

<template>
  <div class="ambient-glow"></div>
  <div class="layout">
    <div v-if="auth.user && sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false"></div>
    <aside v-if="auth.user" class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-brand">
        <RouterLink to="/dashboard"><Logo :height="30" /></RouterLink>
      </div>
      <nav class="sidebar-nav">
        <RouterLink to="/dashboard" class="sidebar-link" :class="{ active: route.path === '/dashboard' }">
          <span class="material-symbols-outlined">space_dashboard</span>
          Dashboard
        </RouterLink>

        <template v-if="teamId">
          <div class="sidebar-section">Infraestrutura</div>
          <RouterLink :to="`/teams/${teamId}`" class="sidebar-link" :class="{ active: isProjectsRoute }">
            <span class="material-symbols-outlined">layers</span>
            Projetos
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/servers`" class="sidebar-link" :class="{ active: isServersRoute }">
            <span class="material-symbols-outlined">dns</span>
            Servidores
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/storages`" class="sidebar-link" :class="{ active: isStoragesRoute }">
            <span class="material-symbols-outlined">cloud</span>
            Armazenamento
          </RouterLink>

          <div class="sidebar-section">Integrações</div>
          <RouterLink :to="`/teams/${teamId}/github`" class="sidebar-link" :class="{ active: isGithubRoute }">
            <span class="material-symbols-outlined">hub</span>
            GitHub
          </RouterLink>

          <div class="sidebar-section">Sistema</div>
          <RouterLink :to="`/teams/${teamId}/notifications`" class="sidebar-link" :class="{ active: isNotificationsRoute }">
            <span class="material-symbols-outlined">notifications</span>
            Notificações
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/updates`" class="sidebar-link" :class="{ active: isUpdatesRoute }">
            <span class="material-symbols-outlined">deployed_code_update</span>
            Atualizações
          </RouterLink>
        </template>
      </nav>
      <div class="sidebar-footer">
        <div>{{ auth.user.name || auth.user.email }}</div>
        <div class="muted">{{ auth.user.email }}</div>
        <div class="sidebar-legal">
          <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="toggleTheme">
            {{ isDark ? "tema escuro" : "tema claro" }}
          </button>
        </div>
      </div>
    </aside>

    <div class="main">
      <header v-if="auth.user" class="topbar">
        <button type="button" class="topbar-menu-btn" aria-label="Abrir menu" @click="sidebarOpen = !sidebarOpen">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <div class="topbar-title">
          <TeamSwitcher v-if="auth.teams.length > 0" :current-name="currentTeamName" />
          <template v-for="(crumb, i) in breadcrumb" :key="`${crumb}-${i}`">
            <span class="crumb-sep">&gt;</span>
            <span class="crumb-item">{{ crumb }}</span>
          </template>
        </div>
        <div class="topbar-user">
          <AccountMenu />
        </div>
      </header>

      <div class="content" :class="{ 'auth-body': !auth.user }">
        <RouterView />
      </div>
    </div>
  </div>
</template>
