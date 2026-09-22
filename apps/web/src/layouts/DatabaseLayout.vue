<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { DatabaseDto, DatabaseStatus, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import Breadcrumb from "../components/Breadcrumb.vue";
import { DATABASE_CONTEXT_KEY, type DatabaseContext } from "../composables/useDatabaseContext";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const databaseId = route.params.databaseId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/databases/${databaseId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;
// The API path and the frontend route path both use "/databases/" (unlike Application, where the
// API's "/applications/" and the route's "/apps/" differ) — one constant does both jobs here.
const routeBase = basePath;

const database = ref<DatabaseDto | null>(null);
const loading = ref(true);
const error = ref("");

const statusBadge: Record<DatabaseStatus, string> = {
  idle: "badge-neutral",
  provisioning: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};

async function reloadDatabase() {
  const res = await api.get<{ database: DatabaseDto }>(basePath);
  database.value = res.database;
}

async function load() {
  loading.value = true;
  try {
    await reloadDatabase();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar banco de dados";
  } finally {
    loading.value = false;
  }
}
load();

const context: DatabaseContext = { database, basePath, environmentPath, error, reloadDatabase };
provide(DATABASE_CONTEXT_KEY, context);

const confirmingDelete = ref(false);
const deleting = ref(false);
let confirmingDeleteTimer: ReturnType<typeof setTimeout> | undefined;
async function deleteDatabase() {
  if (!confirmingDelete.value) {
    confirmingDelete.value = true;
    clearTimeout(confirmingDeleteTimer);
    confirmingDeleteTimer = setTimeout(() => (confirmingDelete.value = false), 3000);
    return;
  }
  clearTimeout(confirmingDeleteTimer);
  deleting.value = true;
  try {
    await api.delete(basePath);
    router.push(environmentPath);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir banco de dados";
    confirmingDelete.value = false;
    deleting.value = false;
  }
}

const unsubscribe = wsClient.on((event: WsServerEvent) => {
  if (event.type === "database.status" && event.databaseId === databaseId && database.value) {
    database.value.status = event.status;
  }
});
onUnmounted(() => {
  unsubscribe();
  clearTimeout(confirmingDeleteTimer);
});

const configRouteNames = ["database-general"];
const isConfigGroup = computed(() => configRouteNames.includes(route.name as string));
</script>

<template>
  <div v-if="loading" class="empty-state">carregando...</div>
  <div v-else-if="!database" class="empty-state">Banco de dados não encontrado.</div>
  <div v-else>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" :current="database.name" />
    <div class="resource-header">
      <div class="resource-title">
        <span class="material-symbols-outlined">database</span>
        {{ database.name }}
        <span class="badge" :class="statusBadge[database.status]">{{ database.status }}</span>
      </div>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="deleting" @click="deleteDatabase">
        <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
        {{ confirmingDelete ? "Confirmar exclusão?" : "Excluir" }}
      </button>
    </div>
    <p class="resource-subtitle mono">
      {{ database.engine }} ·
      <template v-if="database.username">{{ database.username }}@</template>{{ database.serverName }}:{{ database.port }}
      <template v-if="database.databaseName"> / {{ database.databaseName }}</template>
    </p>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="detail-tabs">
      <RouterLink :to="`${routeBase}/backups`" class="detail-tab" :class="{ active: route.name === 'database-backups' }">
        <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
        Backups
      </RouterLink>
      <RouterLink :to="`${routeBase}/general`" class="detail-tab" :class="{ active: isConfigGroup }">
        <span class="material-symbols-outlined" style="font-size: 18px">tune</span>
        Configuration
      </RouterLink>
    </div>

    <div v-if="isConfigGroup" class="detail-layout">
      <nav class="detail-subnav">
        <RouterLink :to="`${routeBase}/general`" class="detail-subnav-item active">Geral</RouterLink>
      </nav>
      <router-view />
    </div>
    <router-view v-else />
  </div>
</template>
