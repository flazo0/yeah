<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from "vue";
import PageState from "../components/PageState.vue";
import { useRoute, useRouter } from "vue-router";
import type { ApplicationDto, ApplicationLifecycleAction, DeploymentDto, WsServerEvent } from "@yeah/shared";
import { wsClient } from "../lib/ws";
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

const configRouteNames = ["app-general", "app-env", "app-storage", "app-advanced", "app-webhooks", "app-tasks", "app-danger"];
const isConfigGroup = computed(() => configRouteNames.includes(route.name as string));

const tabs = computed(() => [
  { to: `${routeBase}/deployments`, label: "Deployments", icon: "rocket_launch", active: route.name === "app-deployments" },
  { to: `${routeBase}/logs`, label: "Logs", icon: "terminal", active: route.name === "app-logs" },
  { to: `${routeBase}/general`, label: "Configuration", icon: "tune", active: isConfigGroup.value },
]);
const subnav = computed(() => [
  { to: `${routeBase}/general`, label: "Geral", active: route.name === "app-general" },
  { to: `${routeBase}/env`, label: "Variáveis de ambiente", active: route.name === "app-env" },
  { to: `${routeBase}/storage`, label: "Armazenamento", active: route.name === "app-storage" },
  { to: `${routeBase}/advanced`, label: "Avançado", active: route.name === "app-advanced" },
  { to: `${routeBase}/webhooks`, label: "Webhooks", active: route.name === "app-webhooks" },
  { to: `${routeBase}/tasks`, label: "Tarefas agendadas", active: route.name === "app-tasks" },
  { to: `${routeBase}/danger`, label: "Zona de perigo", active: route.name === "app-danger" },
]);

const lifecycleBusy = ref(false);
async function lifecycle(action: ApplicationLifecycleAction) {
  lifecycleBusy.value = true;
  error.value = "";
  try {
    await api.post(`${basePath}/lifecycle`, { action });
    // The worker announces the result over WebSocket; this is the fallback if that socket is down.
    setTimeout(() => void reloadApp().catch(() => undefined), 6000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao executar a ação";
  } finally {
    lifecycleBusy.value = false;
  }
}

const unsubscribe = wsClient.on((event: WsServerEvent) => {
  if (event.type === "application.status" && event.applicationId === applicationId && app.value) {
    app.value.status = event.status;
  }
});
onUnmounted(unsubscribe);
</script>

<template>
  <PageState v-if="loading" loading />
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
      <button v-if="app.status === 'stopped'" type="button" class="btn btn-secondary" :disabled="lifecycleBusy" @click="lifecycle('start')">
        <span class="material-symbols-outlined" style="font-size: 18px">play_arrow</span>
        Iniciar
      </button>
      <template v-else-if="app.status === 'running'">
        <button type="button" class="btn btn-secondary" :disabled="lifecycleBusy" @click="lifecycle('restart')">
          <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
          Reiniciar
        </button>
        <button type="button" class="btn btn-secondary" :disabled="lifecycleBusy" @click="lifecycle('stop')">
          <span class="material-symbols-outlined" style="font-size: 18px">stop</span>
          Parar
        </button>
      </template>
      <button type="button" class="btn" :disabled="deploying" @click="deploy">
        <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
        {{ deploying ? "iniciando..." : "Deploy" }}
      </button>
    </template>
    <template #subtitle>
      <p class="resource-subtitle mono">
        <template v-if="app.buildPack === 'image'">{{ app.dockerImage }}</template>
        <template v-else-if="app.buildPack === 'dockerfile_inline'">Dockerfile colado</template>
        <template v-else>{{ app.repoUrl }} ({{ app.branch }}) · {{ app.buildPack }}</template>
        → {{ app.serverName }}:{{ app.port }}
      </p>
      <p v-if="app.domain" class="resource-subtitle">
        <a :href="`https://${app.domain}`" target="_blank" rel="noopener" class="label-link">https://{{ app.domain }}</a>
      </p>
    </template>
    <router-view />
  </ResourceDetailShell>
</template>
