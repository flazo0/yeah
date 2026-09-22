<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ApplicationDto, ApplicationStatus, DeploymentDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import Breadcrumb from "../components/Breadcrumb.vue";
import { APPLICATION_CONTEXT_KEY, type ApplicationContext } from "../composables/useApplicationContext";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const applicationId = route.params.applicationId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/applications/${applicationId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;
const routeBase = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/apps/${applicationId}`;

const app = ref<ApplicationDto | null>(null);
const loading = ref(true);
const error = ref("");

const statusBadge: Record<ApplicationStatus, string> = {
  idle: "badge-neutral",
  deploying: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};

async function reloadApp() {
  const res = await api.get<{ application: ApplicationDto }>(basePath);
  app.value = res.application;
}

async function load() {
  loading.value = true;
  try {
    await reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar aplicação";
  } finally {
    loading.value = false;
  }
}
load();

const lastDeployment = ref<DeploymentDto | null>(null);
const context: ApplicationContext = { app, basePath, environmentPath, error, reloadApp, lastDeployment };
provide(APPLICATION_CONTEXT_KEY, context);

const deploying = ref(false);
async function deploy() {
  deploying.value = true;
  error.value = "";
  try {
    const res = await api.post<{ deployment: DeploymentDto }>(`${basePath}/deploy`, {});
    if (app.value) app.value.status = "deploying";
    lastDeployment.value = res.deployment;
    if (route.name !== "app-deployments") router.push(`${routeBase}/deployments`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar deploy";
  } finally {
    deploying.value = false;
  }
}

const confirmingDelete = ref(false);
const deleting = ref(false);
let confirmingDeleteTimer: ReturnType<typeof setTimeout> | undefined;
async function deleteApplication() {
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
    error.value = err instanceof ApiError ? err.message : "falha ao excluir aplicação";
    confirmingDelete.value = false;
    deleting.value = false;
  }
}

const configRouteNames = ["app-general", "app-env", "app-storage"];
const isConfigGroup = computed(() => configRouteNames.includes(route.name as string));
</script>

<template>
  <div v-if="loading" class="empty-state">carregando...</div>
  <div v-else-if="!app" class="empty-state">Aplicação não encontrada.</div>
  <div v-else>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" :current="app.name" />
    <div class="resource-header">
      <div class="resource-title">
        <span class="material-symbols-outlined">deployed_code</span>
        {{ app.name }}
        <span class="badge" :class="statusBadge[app.status]">{{ app.status }}</span>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="deleting" @click="deleteApplication">
          <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
          {{ confirmingDelete ? "Confirmar exclusão?" : "Excluir" }}
        </button>
        <button type="button" class="btn" :disabled="deploying" @click="deploy">
          <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
          {{ deploying ? "iniciando..." : "Deploy" }}
        </button>
      </div>
    </div>
    <p class="resource-subtitle mono">{{ app.repoUrl }} ({{ app.branch }}) → {{ app.serverName }}:{{ app.port }}</p>
    <p v-if="app.domain" class="resource-subtitle">
      <a :href="`https://${app.domain}`" target="_blank" rel="noopener" class="label-link">https://{{ app.domain }}</a>
    </p>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="detail-tabs">
      <RouterLink :to="`${routeBase}/deployments`" class="detail-tab" :class="{ active: route.name === 'app-deployments' }">
        <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
        Deployments
      </RouterLink>
      <RouterLink :to="`${routeBase}/general`" class="detail-tab" :class="{ active: isConfigGroup }">
        <span class="material-symbols-outlined" style="font-size: 18px">tune</span>
        Configuration
      </RouterLink>
    </div>

    <div v-if="isConfigGroup" class="detail-layout">
      <nav class="detail-subnav">
        <RouterLink :to="`${routeBase}/general`" class="detail-subnav-item" :class="{ active: route.name === 'app-general' }">
          Geral
        </RouterLink>
        <RouterLink :to="`${routeBase}/env`" class="detail-subnav-item" :class="{ active: route.name === 'app-env' }">
          Variáveis de ambiente
        </RouterLink>
        <RouterLink :to="`${routeBase}/storage`" class="detail-subnav-item" :class="{ active: route.name === 'app-storage' }">
          Armazenamento
        </RouterLink>
      </nav>
      <router-view />
    </div>
    <router-view v-else />
  </div>
</template>
