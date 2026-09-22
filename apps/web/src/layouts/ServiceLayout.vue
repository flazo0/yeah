<script setup lang="ts">
import { onUnmounted, provide, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { findServiceCatalogEntry, type ServiceDto, type ServiceStatus, type WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import Breadcrumb from "../components/Breadcrumb.vue";
import { SERVICE_CONTEXT_KEY, type ServiceContext } from "../composables/useServiceContext";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const serviceId = route.params.serviceId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/services/${serviceId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;
const routeBase = basePath;

const service = ref<ServiceDto | null>(null);
const loading = ref(true);
const error = ref("");

const statusBadge: Record<ServiceStatus, string> = {
  idle: "badge-neutral",
  provisioning: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};

async function reloadService() {
  const res = await api.get<{ service: ServiceDto }>(basePath);
  service.value = res.service;
}

async function load() {
  loading.value = true;
  try {
    await reloadService();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar serviço";
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
    error.value = err instanceof ApiError ? err.message : "falha ao reimplantar";
  } finally {
    redeploying.value = false;
  }
}

const confirmingDelete = ref(false);
const deleting = ref(false);
let confirmingDeleteTimer: ReturnType<typeof setTimeout> | undefined;
async function deleteService() {
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
    error.value = err instanceof ApiError ? err.message : "falha ao excluir serviço";
    confirmingDelete.value = false;
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
  clearTimeout(confirmingDeleteTimer);
});
</script>

<template>
  <div v-if="loading" class="empty-state">carregando...</div>
  <div v-else-if="!service" class="empty-state">Serviço não encontrado.</div>
  <div v-else>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" :current="service.name" />
    <div class="resource-header">
      <div class="resource-title">
        <span class="material-symbols-outlined">{{ findServiceCatalogEntry(service.catalogKey)?.icon ?? "widgets" }}</span>
        {{ service.name }}
        <span class="badge" :class="statusBadge[service.status]">{{ service.status }}</span>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="deleting" @click="deleteService">
          <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
          {{ confirmingDelete ? "Confirmar exclusão?" : "Excluir" }}
        </button>
        <button type="button" class="btn" :disabled="redeploying" @click="redeploy">
          <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
          {{ redeploying ? "reimplantando..." : "Reimplantar" }}
        </button>
      </div>
    </div>
    <p class="resource-subtitle mono">{{ service.image }} · {{ service.serverName }}:{{ service.port }}</p>
    <p v-if="service.domain" class="resource-subtitle">
      <a :href="`https://${service.domain}`" target="_blank" rel="noopener" class="label-link">https://{{ service.domain }}</a>
    </p>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="detail-layout">
      <nav class="detail-subnav">
        <RouterLink :to="`${routeBase}/general`" class="detail-subnav-item" :class="{ active: route.name === 'service-general' }">
          Geral
        </RouterLink>
        <RouterLink :to="`${routeBase}/env`" class="detail-subnav-item" :class="{ active: route.name === 'service-env' }">
          Variáveis de ambiente
        </RouterLink>
      </nav>
      <router-view />
    </div>
  </div>
</template>
