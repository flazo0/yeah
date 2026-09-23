<script setup lang="ts">
import { onUnmounted, provide, ref } from "vue";
import PageState from "../components/PageState.vue";
import { useRoute } from "vue-router";
import type { ServerDto, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import StatusBadge from "../components/StatusBadge.vue";
import { SERVER_CONTEXT_KEY, type ServerContext } from "../composables/useServerContext";

const route = useRoute();
const teamId = route.params.teamId as string;
const serverId = route.params.serverId as string;
const routeBase = `/teams/${teamId}/servers/${serverId}`;

const server = ref<ServerDto | null>(null);
const loading = ref(true);
const error = ref("");

async function load() {
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`);
    server.value = res.servers.find((s) => s.id === serverId) ?? null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar servidor";
  } finally {
    loading.value = false;
  }
}
load();

provide(SERVER_CONTEXT_KEY, {
  server,
  teamId,
  error,
  replaceServer: (next: ServerDto) => (server.value = next),
} satisfies ServerContext);

const unsubscribe = wsClient.on((event: WsServerEvent) => {
  const current = server.value;
  if (!current || !("serverId" in event) || event.serverId !== serverId) return;
  if (event.type === "server.status") {
    current.status = event.status;
    current.dockerVersion = event.dockerVersion ?? null;
  } else if (event.type === "server.proxy") {
    current.proxyStatus = event.proxyStatus;
  } else if (event.type === "server.metrics") {
    current.cpuPercent = event.cpuPercent;
    current.memPercent = event.memPercent;
    current.diskPercent = event.diskPercent;
    current.metricsCheckedAt = new Date().toISOString();
  }
});
onUnmounted(unsubscribe);

const tabs = [
  { path: "general", label: "Geral", icon: "tune" },
  { path: "proxy", label: "Proxy", icon: "shield_lock" },
  { path: "metrics", label: "Recursos", icon: "monitor_heart" },
  { path: "terminal", label: "Terminal", icon: "terminal" },
];
</script>

<template>
  <PageState v-if="loading" loading />
  <div v-else-if="!server" class="empty-state">Servidor não encontrado.</div>
  <div v-else>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/servers`" class="breadcrumb-item">Servidores</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">{{ server.name }}</span>
    </nav>
    <div class="resource-header">
      <div class="resource-title">
        <span class="material-symbols-outlined">dns</span>
        {{ server.name }}
        <StatusBadge :status="server.status" />
      </div>
    </div>
    <p class="resource-subtitle mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</p>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="detail-tabs">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.path"
        :to="`${routeBase}/${tab.path}`"
        class="detail-tab"
        :class="{ active: route.path === `${routeBase}/${tab.path}` }"
      >
        <span class="material-symbols-outlined" style="font-size: 18px">{{ tab.icon }}</span>
        {{ tab.label }}
      </RouterLink>
    </div>
    <router-view />
  </div>
</template>
