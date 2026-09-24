<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from "vue";
import PageState from "../components/PageState.vue";
import { useRoute, useRouter } from "vue-router";
import type { DatabaseDto, DatabaseStatus, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import ResourceDetailShell from "../components/ResourceDetailShell.vue";
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

const deleting = ref(false);
async function deleteDatabase() {
  deleting.value = true;
  try {
    await api.delete(basePath);
    router.push(environmentPath);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir banco de dados";
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
});

const configRouteNames = ["database-general", "database-settings"];
const isConfigGroup = computed(() => configRouteNames.includes(route.name as string));

const tabs = computed(() => [
  { to: `${routeBase}/backups`, label: "Backups", icon: "backup", active: route.name === "database-backups" },
  { to: `${routeBase}/general`, label: "Configuration", icon: "tune", active: isConfigGroup.value },
]);
const subnav = computed(() => [
  { to: `${routeBase}/general`, label: "Geral", active: route.name === "database-general" },
  { to: `${routeBase}/settings`, label: "Versão, acesso e saúde", active: route.name === "database-settings" },
]);
</script>

<template>
  <PageState v-if="loading" loading />
  <div v-else-if="!database" class="empty-state">Banco de dados não encontrado.</div>
  <ResourceDetailShell
    v-else
    :team-id="teamId"
    :project-id="projectId"
    :environment-id="environmentId"
    :name="database.name"
    icon="database"
    :status="database.status"
    :error="error"
    :deleting="deleting"
    :tabs="tabs"
    :subnav="isConfigGroup ? subnav : null"
    @delete="deleteDatabase"
  >
    <template #subtitle>
      <p class="resource-subtitle mono">
        {{ database.engine }} ·
        <template v-if="database.username">{{ database.username }}@</template>{{ database.serverName }}:{{ database.port }}
        <template v-if="database.databaseName"> / {{ database.databaseName }}</template>
      </p>
    </template>
    <router-view />
  </ResourceDetailShell>
</template>
