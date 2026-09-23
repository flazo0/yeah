<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ApplicationDto, ApplicationStatus, DeploymentDto } from "@yeah/shared";
import { api, ApiError, postConfirmingOverload } from "../lib/api";
import ResourceDetailShell from "../components/ResourceDetailShell.vue";
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
    const res = await postConfirmingOverload<{ deployment: DeploymentDto }>(`${basePath}/deploy`, {});
    if (app.value) app.value.status = "deploying";
    lastDeployment.value = res.deployment;
    if (route.name !== "app-deployments") router.push(`${routeBase}/deployments`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar deploy";
  } finally {
    deploying.value = false;
  }
}

const deleting = ref(false);
async function deleteApplication() {
  deleting.value = true;
  try {
    await api.delete(basePath);
    router.push(environmentPath);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir aplicação";
    deleting.value = false;
  }
}

const configRouteNames = ["app-general", "app-env", "app-storage"];
const isConfigGroup = computed(() => configRouteNames.includes(route.name as string));

const tabs = computed(() => [
  { to: `${routeBase}/deployments`, label: "Deployments", icon: "rocket_launch", active: route.name === "app-deployments" },
  { to: `${routeBase}/general`, label: "Configuration", icon: "tune", active: isConfigGroup.value },
]);
const subnav = computed(() => [
  { to: `${routeBase}/general`, label: "Geral", active: route.name === "app-general" },
  { to: `${routeBase}/env`, label: "Variáveis de ambiente", active: route.name === "app-env" },
  { to: `${routeBase}/storage`, label: "Armazenamento", active: route.name === "app-storage" },
]);
</script>

<template>
  <div v-if="loading" class="empty-state"><span class="spinner"></span> carregando...</div>
  <div v-else-if="!app" class="empty-state">Aplicação não encontrada.</div>
  <ResourceDetailShell
    v-else
    :team-id="teamId"
    :project-id="projectId"
    :environment-id="environmentId"
    :name="app.name"
    icon="deployed_code"
    :status="app.status"
    :error="error"
    :deleting="deleting"
    :tabs="tabs"
    :subnav="isConfigGroup ? subnav : null"
    @delete="deleteApplication"
  >
    <template #actions>
      <button type="button" class="btn" :disabled="deploying" @click="deploy">
        <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
        {{ deploying ? "iniciando..." : "Deploy" }}
      </button>
    </template>
    <template #subtitle>
      <p class="resource-subtitle mono">{{ app.repoUrl }} ({{ app.branch }}) → {{ app.serverName }}:{{ app.port }}</p>
      <p v-if="app.domain" class="resource-subtitle">
        <a :href="`https://${app.domain}`" target="_blank" rel="noopener" class="label-link">https://{{ app.domain }}</a>
      </p>
    </template>
    <router-view />
  </ResourceDetailShell>
</template>
