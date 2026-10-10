<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from "vue";
import PageState from "../components/PageState.vue";
import { useRoute, useRouter } from "vue-router";
import { findServiceCatalogEntry, type ServiceDto, type ServiceStatus, type WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import ResourceDetailShell from "../components/ResourceDetailShell.vue";
import { SERVICE_CONTEXT_KEY, type ServiceContext } from "../composables/useServiceContext";
import { i18n } from "../lib/i18n";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const serviceId = route.params.serviceId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/services/${serviceId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;
const routeBase = basePath;
const subnav = computed(() =>
  service.value?.composeContent
    ? [
        { to: `${routeBase}/general`, label: i18n.global.t("common.general"), active: route.name === "service-general" },
        { to: `${routeBase}/compose`, label: "Compose", active: route.name === "service-compose" },
        { to: `${routeBase}/domains`, label: i18n.global.t("serviceLayout.dominios"), active: route.name === "service-domains" },
        { to: `${routeBase}/logs`, label: "Logs", active: route.name === "service-logs" },
        { to: `${routeBase}/backups`, label: "Backups", active: route.name === "service-backups" },
      ]
    : [
        { to: `${routeBase}/general`, label: i18n.global.t("common.general"), active: route.name === "service-general" },
        { to: `${routeBase}/env`, label: i18n.global.t("serviceLayout.variaveisDeAmbiente"), active: route.name === "service-env" },
      ],
);

const service = ref<ServiceDto | null>(null);
const loading = ref(true);
const error = ref("");

async function reloadService() {
  const res = await api.get<{ service: ServiceDto }>(basePath);
  service.value = res.service;
}

async function load() {
  loading.value = true;
  try {
    await reloadService();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceLayout.falhaAoCarregarServico");
  } finally {
    loading.value = false;
  }
}
load();

const context: ServiceContext = { service, basePath, environmentPath, error, reloadService };
provide(SERVICE_CONTEXT_KEY, context);

const redeploying = ref(false);
async function redeploy() {
  redeploying.value = true;
  error.value = "";
  try {
    await api.post(`${basePath}/redeploy`, {});
    if (service.value) service.value.status = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceLayout.falhaAoReimplantar");
  } finally {
    redeploying.value = false;
  }
}

const deleting = ref(false);
async function deleteService() {
  deleting.value = true;
  try {
    await api.delete(basePath);
    router.push(environmentPath);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceLayout.falhaAoExcluirServico");
    deleting.value = false;
  }
}

const unsubscribe = wsClient.on((event: WsServerEvent) => {
  if (event.type === "service.status" && event.serviceId === serviceId && service.value) {
    service.value.status = event.status;
  }
});
onUnmounted(() => {
  unsubscribe();
});
</script>

<template>
  <PageState v-if="loading" loading />
  <div v-else-if="!service" class="empty-state">{{ $t("serviceLayout.servicoNaoEncontrado") }}</div>
  <ResourceDetailShell
    v-else
    :team-id="teamId"
    :project-id="projectId"
    :environment-id="environmentId"
    :name="service.name"
    :icon="service.composeContent ? 'stacks' : (findServiceCatalogEntry(service.catalogKey)?.icon ?? 'widgets')"
    :status="service.status"
    :error="error"
    :deleting="deleting"
    :subnav="subnav"
    @delete="deleteService"
  >
    <template #actions>
      <button type="button" class="btn" :disabled="redeploying" @click="redeploy">
        <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
        {{ redeploying ? $t("serviceLayout.reimplantando") : "Reimplantar" }}
      </button>
    </template>
    <template #subtitle>
      <p class="resource-subtitle mono">
        <template v-if="service.composeContent">{{ $t("serviceLayout.p0ContainerP1P2P3", { p0: service.stackServices.length, p1: service.stackServices.length === 1 ? "" : "s", p2: service.stackServices.join(", "), p3: service.serverName }) }}</template>
        <template v-else>{{ service.image }} · {{ service.serverName }}:{{ service.port }}</template>
      </p>
      <p v-for="d in service.domains" :key="d.domain" class="resource-subtitle">
        <a :href="`https://${d.domain}`" target="_blank" rel="noopener" class="label-link">{{ $t("serviceLayout.httpsP0", { p0: d.domain }) }}</a> <span class="muted">→ {{ d.service }}:{{ d.port }}</span>
      </p>
      <p v-if="service.domain" class="resource-subtitle">
        <a :href="`https://${service.domain}`" target="_blank" rel="noopener" class="label-link">{{ $t("serviceLayout.httpsP0", { p0: service.domain }) }}</a>
      </p>
    </template>
    <router-view />
  </ResourceDetailShell>
</template>
