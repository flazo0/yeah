<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { isDark, toggleTheme } from "./lib/theme";
import Logo from "./components/Logo.vue";
import AccountMenu from "./components/AccountMenu.vue";
import TeamSwitcher from "./components/TeamSwitcher.vue";
import GlobalSearch from "./components/GlobalSearch.vue";

const auth = useAuthStore();
const route = useRoute();

const sidebarOpen = ref(false);
const COLLAPSE_KEY = "yeah:sidebar-collapsed";
let storedCollapsed = false;
try {
  storedCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
} catch {
  // storage blocked — starts expanded
}
const sidebarCollapsed = ref(storedCollapsed);
watch(sidebarCollapsed, (v) => {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  } catch {
    // preference just won't persist
  }
});
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
const isServersRoute = computed(() => Boolean(teamId.value) && route.path.startsWith(`/teams/${teamId.value}/servers`));
const isStoragesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/storages`);
const isSourcesRoute = computed(() => Boolean(teamId.value) && route.path.startsWith(`/teams/${teamId.value}/sources`));
const isNotificationsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/notifications`);
const isVariablesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/variables`);
const isTeamRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/team`);
const isSettingsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/settings`);
const isUpdatesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/updates`);

// Rendered after the TeamSwitcher segment — just the section trail, the team name itself is the
// switcher now, not a plain string in this list.
const breadcrumb = computed(() => {
  if (!teamId.value) return [];
  if (isServersRoute.value) return ["Servidores"];
  if (isStoragesRoute.value) return ["Armazenamento"];
  if (isSourcesRoute.value) return ["Fontes"];
  if (isNotificationsRoute.value) return ["Notificações"];
  if (isUpdatesRoute.value) return ["Atualizações"];
  if (isVariablesRoute.value) return ["Variáveis"];
  if (isTeamRoute.value) return ["Time"];
  if (isSettingsRoute.value) return ["Configurações"];
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
  <div class="layout" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <div v-if="auth.user && sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false"></div>
    <aside v-if="auth.user" class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-brand">
        <RouterLink to="/dashboard"><Logo :height="30" /></RouterLink>
      </div>
      <div class="sidebar-search"><GlobalSearch :team-id="teamId ?? auth.teams[0]?.id ?? null" /></div>
      <nav class="sidebar-nav">
        <div class="sidebar-section">Workspace</div>
        <RouterLink to="/dashboard" class="sidebar-link" :class="{ active: route.path === '/dashboard' }">
          <span class="material-symbols-outlined">space_dashboard</span>
          Dashboard
        </RouterLink>

        <template v-if="teamId">
          <RouterLink :to="`/teams/${teamId}`" class="sidebar-link" :class="{ active: isProjectsRoute }">
            <span class="material-symbols-outlined">layers</span>
            Projetos
          </RouterLink>

          <div class="sidebar-section">Infraestrutura</div>
          <RouterLink :to="`/teams/${teamId}/servers`" class="sidebar-link" :class="{ active: isServersRoute }">
            <span class="material-symbols-outlined">dns</span>
            Servidores
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/sources`" class="sidebar-link" :class="{ active: isSourcesRoute }">
            <span class="material-symbols-outlined">hub</span>
            Fontes
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/variables`" class="sidebar-link" :class="{ active: isVariablesRoute }">
            <span class="material-symbols-outlined">data_object</span>
            Variáveis
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/storages`" class="sidebar-link" :class="{ active: isStoragesRoute }">
            <span class="material-symbols-outlined">cloud</span>
            Armazenamento
          </RouterLink>


          <div class="sidebar-section">Gerenciar</div>
          <RouterLink :to="`/teams/${teamId}/team`" class="sidebar-link" :class="{ active: isTeamRoute }">
            <span class="material-symbols-outlined">group</span>
            Time
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/notifications`" class="sidebar-link" :class="{ active: isNotificationsRoute }">
            <span class="material-symbols-outlined">notifications</span>
            Notificações
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/updates`" class="sidebar-link" :class="{ active: isUpdatesRoute }">
            <span class="material-symbols-outlined">deployed_code_update</span>
            Atualizações
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/settings`" class="sidebar-link" :class="{ active: isSettingsRoute }">
            <span class="material-symbols-outlined">settings</span>
            Configurações
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
        <button
          type="button"
          class="topbar-collapse-btn"
          :aria-label="sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'"
          :title="sidebarCollapsed ? 'Expandir menu' : 'Recolher menu'"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          <span class="material-symbols-outlined">{{ sidebarCollapsed ? 'menu' : 'menu_open' }}</span>
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
