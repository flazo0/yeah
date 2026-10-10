<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "./stores/auth";
import { isDark, toggleTheme } from "./lib/theme";
import Logo from "./components/Logo.vue";
import AccountMenu from "./components/AccountMenu.vue";
import TeamSwitcher from "./components/TeamSwitcher.vue";
import GlobalSearch from "./components/GlobalSearch.vue";
import { i18n } from "./lib/i18n";

const { t } = useI18n();
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
  return team?.name ?? i18n.global.t("common.team");
});
const projectId = computed(() => (typeof route.params.projectId === "string" ? route.params.projectId : null));
const environmentId = computed(() =>
  typeof route.params.environmentId === "string" ? route.params.environmentId : null,
);

const isProjectsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}`);
const isServersRoute = computed(() => Boolean(teamId.value) && route.path.startsWith(`/teams/${teamId.value}/servers`));
const isKeysTokensRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/keys-tokens`);
const isRegistriesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/registries`);
const isStoragesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/storages`);
const isSourcesRoute = computed(() => Boolean(teamId.value) && route.path.startsWith(`/teams/${teamId.value}/sources`));
const isNotificationsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/notifications`);
const isLogDrainsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/log-drains`);
const isVariablesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/variables`);
const isTeamRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/team`);
const isSettingsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/settings`);
const isUpdatesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/updates`);

// Rendered after the TeamSwitcher segment — just the section trail, the team name itself is the
// switcher now, not a plain string in this list.
const breadcrumb = computed(() => {
  if (!teamId.value) return [];
  if (isServersRoute.value) return [i18n.global.t("common.servers")];
  if (isKeysTokensRoute.value) return ["Keys & Tokens"];
  if (isStoragesRoute.value) return [i18n.global.t("common.storage")];
  if (isRegistriesRoute.value) return ["Registries"];
  if (isSourcesRoute.value) return [i18n.global.t("common.sources")];
  if (isNotificationsRoute.value) return [i18n.global.t("app.notificacoes")];
  if (isLogDrainsRoute.value) return ["Log Drains"];
  if (isUpdatesRoute.value) return [i18n.global.t("app.atualizacoes")];
  if (isVariablesRoute.value) return [i18n.global.t("app.variaveis")];
  if (isTeamRoute.value) return [i18n.global.t("common.team")];
  if (isSettingsRoute.value) return [i18n.global.t("app.configuracoes")];
  if (!projectId.value) return [i18n.global.t("common.projects")];
  if (!environmentId.value) return [i18n.global.t("common.projects"), i18n.global.t("common.environments")];
  if (route.params.applicationId) return [i18n.global.t("common.projects"), i18n.global.t("common.environment"), i18n.global.t("app.aplicacao")];
  if (route.params.databaseId) return [i18n.global.t("common.projects"), i18n.global.t("common.environment"), i18n.global.t("app.bancoDeDados")];
  if (route.params.serviceId) return [i18n.global.t("common.projects"), i18n.global.t("common.environment"), i18n.global.t("app.servico")];
  return [i18n.global.t("common.projects"), i18n.global.t("common.resources")];
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
        <div class="sidebar-section">{{ t("nav.workspace") }}</div>
        <RouterLink to="/dashboard" class="sidebar-link" :class="{ active: route.path === '/dashboard' }">
          <span class="material-symbols-outlined">space_dashboard</span>
          {{ t("nav.dashboard") }}
        </RouterLink>

        <template v-if="teamId">
          <RouterLink :to="`/teams/${teamId}`" class="sidebar-link" :class="{ active: isProjectsRoute }">
            <span class="material-symbols-outlined">layers</span>
            {{ t("nav.projects") }}
          </RouterLink>

          <div class="sidebar-section">{{ t("nav.infrastructure") }}</div>
          <RouterLink :to="`/teams/${teamId}/servers`" class="sidebar-link" :class="{ active: isServersRoute }">
            <span class="material-symbols-outlined">dns</span>
            {{ t("nav.servers") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/sources`" class="sidebar-link" :class="{ active: isSourcesRoute }">
            <span class="material-symbols-outlined">hub</span>
            {{ t("nav.sources") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/keys-tokens`" class="sidebar-link" :class="{ active: isKeysTokensRoute }">
            <span class="material-symbols-outlined">key</span>
            {{ t("nav.keysTokens") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/variables`" class="sidebar-link" :class="{ active: isVariablesRoute }">
            <span class="material-symbols-outlined">data_object</span>
            {{ t("nav.variables") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/storages`" class="sidebar-link" :class="{ active: isStoragesRoute }">
            <span class="material-symbols-outlined">cloud</span>
            {{ t("nav.storage") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/registries`" class="sidebar-link" :class="{ active: isRegistriesRoute }">
            <span class="material-symbols-outlined">inventory_2</span>
            {{ t("nav.registries") }}
          </RouterLink>


          <div class="sidebar-section">{{ t("nav.manage") }}</div>
          <RouterLink :to="`/teams/${teamId}/team`" class="sidebar-link" :class="{ active: isTeamRoute }">
            <span class="material-symbols-outlined">group</span>
            {{ t("nav.team") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/notifications`" class="sidebar-link" :class="{ active: isNotificationsRoute }">
            <span class="material-symbols-outlined">notifications</span>
            {{ t("nav.notifications") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/log-drains`" class="sidebar-link" :class="{ active: isLogDrainsRoute }">
            <span class="material-symbols-outlined">receipt_long</span>
            {{ t("nav.logDrains") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/updates`" class="sidebar-link" :class="{ active: isUpdatesRoute }">
            <span class="material-symbols-outlined">deployed_code_update</span>
            {{ t("nav.updates") }}
          </RouterLink>
          <RouterLink :to="`/teams/${teamId}/settings`" class="sidebar-link" :class="{ active: isSettingsRoute }">
            <span class="material-symbols-outlined">settings</span>
            {{ t("nav.settings") }}
          </RouterLink>
        </template>
      </nav>
      <div class="sidebar-footer">
        <div>{{ auth.user.name || auth.user.email }}</div>
        <div class="muted">{{ auth.user.email }}</div>
        <div class="sidebar-legal">
          <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="toggleTheme">
            {{ isDark ? t("nav.themeDark") : t("nav.themeLight") }}
          </button>
        </div>
      </div>
    </aside>

    <div class="main">
      <header v-if="auth.user" class="topbar">
        <button type="button" class="topbar-menu-btn" :aria-label="t('common.openMenu')" @click="sidebarOpen = !sidebarOpen">
          <span class="material-symbols-outlined">menu</span>
        </button>
        <button
          type="button"
          class="topbar-collapse-btn"
          :aria-label="sidebarCollapsed ? t('common.expandMenu') : t('common.collapseMenu')"
          :title="sidebarCollapsed ? t('common.expandMenu') : t('common.collapseMenu')"
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
