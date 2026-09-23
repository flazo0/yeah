<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { ServerDto, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import PageState from "../components/PageState.vue";
import StatusBadge from "../components/StatusBadge.vue";
import ViewToggle from "../components/ViewToggle.vue";
import ListPager from "../components/ListPager.vue";
import ServerMetricBars from "../components/ServerMetricBars.vue";

const route = useRoute();
const teamId = route.params.teamId as string;

const servers = ref<ServerDto[]>([]);
const loading = ref(true);
const error = ref("");

const view = ref<"list" | "grid">("list");
const search = ref("");
const statusFilter = ref("");
const page = ref(1);
const pageSize = ref(10);
watch([search, statusFilter], () => (page.value = 1));

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return servers.value
    .filter((s) => (!statusFilter.value || s.status === statusFilter.value) && (!q || `${s.name} ${s.host}`.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
});
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

async function loadServers() {
  loading.value = true;
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`);
    servers.value = res.servers;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar servidores";
  } finally {
    loading.value = false;
  }
}

async function testConnection(serverId: string) {
  const server = servers.value.find((s) => s.id === serverId);
  if (server) server.status = "pending";
  try {
    await api.post(`/teams/${teamId}/servers/${serverId}/test-connection`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao testar conexão";
  }
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  loadServers();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    const server = "serverId" in event ? servers.value.find((s) => s.id === event.serverId) : undefined;
    if (!server) return;
    if (event.type === "server.status") {
      server.status = event.status;
      server.dockerVersion = event.dockerVersion ?? null;
    } else if (event.type === "server.proxy") {
      server.proxyStatus = event.proxyStatus;
    } else if (event.type === "server.metrics") {
      server.cpuPercent = event.cpuPercent;
      server.memPercent = event.memPercent;
      server.diskPercent = event.diskPercent;
      server.metricsCheckedAt = new Date().toISOString();
    }
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Servidores</h1>
        <p>Máquinas conectadas via SSH onde os recursos rodam.</p>
      </div>
      <RouterLink :to="`/teams/${teamId}/servers/new`" class="btn">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Adicionar servidor
      </RouterLink>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="rtable-toolbar">
      <div class="rtable-search input-icon">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" class="form-control" type="search" placeholder="Buscar servidores" aria-label="Buscar servidores" />
      </div>
      <div class="rtable-filters">
        <select v-model="statusFilter" class="form-control" aria-label="Filtrar por status">
          <option value="">Todo status</option>
          <option value="connected">connected</option>
          <option value="pending">pending</option>
          <option value="error">error</option>
        </select>
      </div>
      <ViewToggle v-model="view" storage-key="yeah:servers-view" />
    </div>

    <PageState :loading="loading" :empty="servers.length === 0" empty-icon="dns" empty-text="Nenhum servidor ainda. Adicione o primeiro pelo botão acima.">
      <div v-if="filtered.length === 0" class="empty-state">Nenhum servidor bate com os filtros.</div>

      <div v-else-if="view === 'list'" class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>Servidor</th>
              <th>Status</th>
              <th>Proxy</th>
              <th>Recursos</th>
              <th>Docker</th>
              <th class="rtable-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="server in paged" :key="server.id">
              <td data-label="Servidor">
                <RouterLink :to="`/teams/${teamId}/servers/${server.id}/general`" class="rtable-name">
                  <span class="rtable-icon"><span class="material-symbols-outlined">dns</span></span>
                  <span class="rtable-name-text">
                    <strong>{{ server.name }}</strong>
                    <small class="mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</small>
                  </span>
                </RouterLink>
              </td>
              <td data-label="Status"><StatusBadge :status="server.status" /></td>
              <td data-label="Proxy"><StatusBadge :status="server.proxyStatus" /></td>
              <td data-label="Recursos" class="server-metrics-cell"><ServerMetricBars :server="server" compact /></td>
              <td data-label="Docker" class="mono">{{ server.dockerVersion || "-" }}</td>
              <td class="rtable-actions-col">
                <button type="button" class="rtable-delete" title="Testar conexão" aria-label="Testar conexão" @click="testConnection(server.id)">
                  <span class="material-symbols-outlined">sync</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="project-grid">
        <RouterLink v-for="server in paged" :key="server.id" :to="`/teams/${teamId}/servers/${server.id}/general`" class="project-card server-card">
          <div class="project-card-head">
            <span class="rtable-icon"><span class="material-symbols-outlined">dns</span></span>
            <span class="rtable-name-text">
              <strong>{{ server.name }}</strong>
              <small class="mono muted">{{ server.host }}</small>
            </span>
            <StatusBadge :status="server.status" style="margin-left: auto" />
          </div>
          <ServerMetricBars :server="server" compact />
        </RouterLink>
      </div>

      <ListPager v-if="filtered.length > 0" v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" size-key="yeah:servers-page-size" />
    </PageState>
  </div>
</template>
