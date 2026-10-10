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
import { i18n } from "../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("servers.falhaAoCarregarServidores");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("servers.falhaAoTestarConexao");
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
        <h1>{{ $t("servers.servidores") }}</h1>
        <p>{{ $t("servers.maquinasConectadasViaSshOnde") }}</p>
      </div>
      <RouterLink :to="`/teams/${teamId}/servers/new`" class="btn">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        {{ $t("servers.adicionarServidor") }}
      </RouterLink>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="rtable-toolbar">
      <div class="rtable-search input-icon">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" class="form-control" type="search" :placeholder="$t('servers.buscarServidores')" :aria-label="$t('servers.buscarServidores')" />
      </div>
      <div class="rtable-filters">
        <select v-model="statusFilter" class="form-control" :aria-label="$t('servers.filtrarPorStatus')">
          <option value="">{{ $t("servers.todoStatus") }}</option>
          <option value="connected">{{ $t("servers.connected") }}</option>
          <option value="pending">{{ $t("servers.pending") }}</option>
          <option value="error">{{ $t("servers.error") }}</option>
        </select>
      </div>
      <ViewToggle v-model="view" storage-key="yeah:servers-view" />
    </div>

    <PageState :loading="loading" :empty="servers.length === 0" empty-icon="dns" :empty-text="$t('servers.nenhumServidorAindaAdicioneA')">
      <div v-if="filtered.length === 0" class="empty-state">{{ $t("servers.nenhumServidorBateComOs") }}</div>

      <div v-else-if="view === 'list'" class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>{{ $t("servers.servidor") }}</th>
              <th>{{ $t("servers.status") }}</th>
              <th>{{ $t("servers.proxy") }}</th>
              <th>{{ $t("servers.recursos") }}</th>
              <th>{{ $t("servers.docker") }}</th>
              <th class="rtable-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="server in paged" :key="server.id">
              <td :data-label="$t('servers.labelServidor')">
                <RouterLink :to="`/teams/${teamId}/servers/${server.id}/general`" class="rtable-name">
                  <span class="rtable-icon"><span class="material-symbols-outlined">dns</span></span>
                  <span class="rtable-name-text">
                    <strong>{{ server.name }}</strong>
                    <small class="mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</small>
                  </span>
                </RouterLink>
              </td>
              <td :data-label="$t('servers.labelStatus')"><StatusBadge :status="server.status" /></td>
              <td :data-label="$t('servers.labelProxy')"><StatusBadge :status="server.proxyStatus" /></td>
              <td :data-label="$t('servers.labelRecursos')" class="server-metrics-cell"><ServerMetricBars :server="server" compact /></td>
              <td :data-label="$t('servers.labelDocker')" class="mono">{{ server.dockerVersion || "-" }}</td>
              <td class="rtable-actions-col">
                <button type="button" class="rtable-delete" :title="$t('servers.testarConexao')" :aria-label="$t('servers.testarConexao')" @click="testConnection(server.id)">
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
