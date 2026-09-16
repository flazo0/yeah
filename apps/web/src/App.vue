<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { isDark, toggleTheme } from "./lib/theme";
import Logo from "./components/Logo.vue";
import AccountMenu from "./components/AccountMenu.vue";

const auth = useAuthStore();
const route = useRoute();

const teamId = computed(() => (typeof route.params.teamId === "string" ? route.params.teamId : null));
const projectId = computed(() => (typeof route.params.projectId === "string" ? route.params.projectId : null));
const environmentId = computed(() =>
  typeof route.params.environmentId === "string" ? route.params.environmentId : null,
);

const isProjectsRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}`);
const isServersRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/servers`);
const isStoragesRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/storages`);
const isGithubRoute = computed(() => Boolean(teamId.value) && route.path === `/teams/${teamId.value}/github`);

const breadcrumb = computed(() => {
  if (!teamId.value) return ["Times"];
  const team = auth.teams.find((t) => t.id === teamId.value);
  const base = ["Times", team?.name ?? "Time"];
  if (isServersRoute.value) return [...base, "Servidores"];
  if (isStoragesRoute.value) return [...base, "Armazenamento"];
  if (isGithubRoute.value) return [...base, "GitHub"];
  if (!projectId.value) return [...base, "Projetos"];
  if (!environmentId.value) return [...base, "Projetos", "Ambientes"];
  if (route.params.applicationId) return [...base, "Projetos", "Ambiente", "Aplicação"];
  if (route.params.databaseId) return [...base, "Projetos", "Ambiente", "Banco de dados"];
  return [...base, "Projetos", "Recursos"];
});
</script>

<template>
  <div class="ambient-glow"></div>
  <div class="layout">
    <aside v-if="auth.user" class="sidebar">
      <div class="sidebar-brand">
        <RouterLink to="/dashboard"><Logo :height="30" /></RouterLink>
      </div>
      <nav class="sidebar-nav">
        <div class="sidebar-section">Operação</div>
        <RouterLink to="/dashboard" class="sidebar-link" :class="{ active: route.path === '/dashboard' }">
          <span class="material-symbols-outlined">space_dashboard</span>
          Times
        </RouterLink>
        <RouterLink
          v-if="teamId"
          :to="`/teams/${teamId}`"
          class="sidebar-link"
          :class="{ active: isProjectsRoute }"
        >
          <span class="material-symbols-outlined">layers</span>
          Projetos
        </RouterLink>
        <RouterLink
          v-if="teamId"
          :to="`/teams/${teamId}/servers`"
          class="sidebar-link"
          :class="{ active: isServersRoute }"
        >
          <span class="material-symbols-outlined">dns</span>
          Servidores
        </RouterLink>
        <RouterLink
          v-if="teamId"
          :to="`/teams/${teamId}/storages`"
          class="sidebar-link"
          :class="{ active: isStoragesRoute }"
        >
          <span class="material-symbols-outlined">cloud</span>
          Armazenamento
        </RouterLink>
        <RouterLink
          v-if="teamId"
          :to="`/teams/${teamId}/github`"
          class="sidebar-link"
          :class="{ active: isGithubRoute }"
        >
          <span class="material-symbols-outlined">hub</span>
          GitHub
        </RouterLink>
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
        <div class="topbar-title">
          <template v-for="(crumb, i) in breadcrumb" :key="`${crumb}-${i}`">
            <span v-if="i > 0" class="crumb-sep">&gt;</span>
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
