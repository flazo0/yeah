<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ApplicationDto, DatabaseDto, ServerDto, ServiceDto, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import Breadcrumb from "../components/Breadcrumb.vue";

const route = useRoute();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

type ResourceKind = "application" | "database" | "service";
interface Resource {
  kind: ResourceKind;
  id: string;
  name: string;
  status: string;
  statusDot: string;
  statusBadge: string;
  icon: string;
  detail: string;
  serverName: string;
  path: string;
}

const apps = ref<ApplicationDto[]>([]);
const dbs = ref<DatabaseDto[]>([]);
const svcs = ref<ServiceDto[]>([]);
const teamServers = ref<ServerDto[]>([]);
const loading = ref(true);
const error = ref("");

const statusDot: Record<string, string> = {
  idle: "status-dot-neutral",
  deploying: "status-dot-warn",
  provisioning: "status-dot-warn",
  running: "status-dot-good",
  error: "status-dot-bad",
};
const statusBadge: Record<string, string> = {
  idle: "badge-neutral",
  deploying: "badge-warn",
  provisioning: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};

const resources = computed<Resource[]>(() => {
  const list: Resource[] = [
    ...apps.value.map((app) => ({
      kind: "application" as const,
      id: app.id,
      name: app.name,
      status: app.status,
      statusDot: statusDot[app.status] ?? "status-dot-neutral",
      statusBadge: statusBadge[app.status] ?? "badge-neutral",
      icon: "deployed_code",
      detail: `${app.repoUrl} (${app.branch})`,
      serverName: app.serverName,
      path: `${basePath}/apps/${app.id}`,
    })),
    ...dbs.value.map((item) => ({
      kind: "database" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      statusDot: statusDot[item.status] ?? "status-dot-neutral",
      statusBadge: statusBadge[item.status] ?? "badge-neutral",
      icon: "database",
      detail: `${item.engine} · ${item.image}`,
      serverName: item.serverName,
      path: `${basePath}/databases/${item.id}`,
    })),
    ...svcs.value.map((item) => ({
      kind: "service" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      statusDot: statusDot[item.status] ?? "status-dot-neutral",
      statusBadge: statusBadge[item.status] ?? "badge-neutral",
      icon: "widgets",
      detail: `${item.catalogKey} · ${item.image}`,
      serverName: item.serverName,
      path: `${basePath}/services/${item.id}`,
    })),
  ];
  return list.sort((a, b) => a.name.localeCompare(b.name));
});

async function load() {
  loading.value = true;
  try {
    const [appsRes, dbsRes, svcsRes, serversRes] = await Promise.all([
      api.get<{ applications: ApplicationDto[] }>(`${basePath}/applications`),
      api.get<{ databases: DatabaseDto[] }>(`${basePath}/databases`),
      api.get<{ services: ServiceDto[] }>(`${basePath}/services`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
    ]);
    apps.value = appsRes.applications;
    dbs.value = dbsRes.databases;
    svcs.value = svcsRes.services;
    teamServers.value = serversRes.servers;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar o ambiente";
  } finally {
    loading.value = false;
  }
}

const pendingDeleteId = ref<string | null>(null);
let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined;

function armDelete(id: string) {
  if (pendingDeleteId.value === id) return;
  pendingDeleteId.value = id;
  clearTimeout(pendingDeleteTimer);
  pendingDeleteTimer = setTimeout(() => {
    if (pendingDeleteId.value === id) pendingDeleteId.value = null;
  }, 3000);
}

async function deleteResource(resource: Resource) {
  if (pendingDeleteId.value !== resource.id) {
    armDelete(resource.id);
    return;
  }
  pendingDeleteId.value = null;
  clearTimeout(pendingDeleteTimer);
  try {
    if (resource.kind === "application") {
      await api.delete(`${basePath}/applications/${resource.id}`);
      apps.value = apps.value.filter((a) => a.id !== resource.id);
    } else if (resource.kind === "database") {
      await api.delete(`${basePath}/databases/${resource.id}`);
      dbs.value = dbs.value.filter((d) => d.id !== resource.id);
    } else {
      await api.delete(`${basePath}/services/${resource.id}`);
      svcs.value = svcs.value.filter((s) => s.id !== resource.id);
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir recurso";
  }
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "database.status") {
      const database = dbs.value.find((d) => d.id === event.databaseId);
      if (database) database.status = event.status;
    }
    if (event.type === "service.status") {
      const service = svcs.value.find((s) => s.id === event.serviceId);
      if (service) service.status = event.status;
    }
  });
});
onUnmounted(() => {
  unsubscribe?.();
  clearTimeout(pendingDeleteTimer);
});
</script>

<template>
  <div>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" />
    <div class="page-header">
      <div>
        <h1>Recursos</h1>
        <p>Aplicações, bancos de dados e serviços deste ambiente.</p>
      </div>
      <RouterLink v-if="teamServers.length > 0" :to="`${basePath}/new`" class="btn">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Novo recurso
      </RouterLink>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!loading && teamServers.length === 0" class="card mb-16">
      <div class="card-body">
        <div class="empty-state">
          Você precisa de um <RouterLink :to="`/teams/${teamId}/servers`" class="label-link">servidor conectado</RouterLink>
          antes de criar aplicações, bancos de dados ou serviços.
        </div>
      </div>
    </div>

    <div class="card">
      <div v-if="loading" class="card-body"><div class="empty-state">carregando...</div></div>
      <div v-else-if="resources.length === 0" class="card-body">
        <div class="empty-state">
          Nenhum recurso ainda.
          <template v-if="teamServers.length > 0">
            <RouterLink :to="`${basePath}/new`" class="label-link">Crie o primeiro</RouterLink>.
          </template>
        </div>
      </div>
      <div v-else class="card-body">
        <div class="resource-cards">
          <div v-for="item in resources" :key="item.id" class="resource-card-wrap">
            <RouterLink :to="item.path" class="resource-card">
              <div class="name">
                <span class="status-dot" :class="item.statusDot"></span>
                <span class="material-symbols-outlined" style="font-size: 16px">{{ item.icon }}</span>
                {{ item.name }}
                <span class="badge" :class="item.statusBadge" style="margin-left: auto">{{ item.status }}</span>
              </div>
              <div class="desc mono">{{ item.detail }}</div>
              <div class="desc">{{ item.serverName }}</div>
            </RouterLink>
            <button
              type="button"
              class="resource-card-delete"
              :class="{ confirming: pendingDeleteId === item.id }"
              :title="pendingDeleteId === item.id ? 'Clique de novo pra confirmar' : 'Excluir'"
              @click="deleteResource(item)"
            >
              <span class="material-symbols-outlined">{{ pendingDeleteId === item.id ? "warning" : "delete" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
