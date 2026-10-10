<script setup lang="ts">
import { computed, onUnmounted, provide, ref, watch } from "vue";
import PageState from "../components/PageState.vue";
import { useRoute, useRouter } from "vue-router";
import type { ApplicationDto, ApplicationLifecycleAction, DeploymentDto, WsServerEvent } from "@yeah/shared";
import { wsClient } from "../lib/ws";
import { api, ApiError, postConfirmingOverload } from "../lib/api";
import ResourceDetailShell from "../components/ResourceDetailShell.vue";
import { APPLICATION_CONTEXT_KEY, type ApplicationContext } from "../composables/useApplicationContext";
import { i18n } from "../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationLayout.falhaAoCarregarAplicacao");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationLayout.falhaAoIniciarDeploy");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationLayout.falhaAoExcluirAplicacao");
    deleting.value = false;
  }
}

const configRouteNames = ["app-general", "app-env", "app-storage", "app-advanced", "app-source", "app-server", "app-operations", "app-previews", "app-webhooks", "app-tasks", "app-danger"];
const isConfigGroup = computed(() => configRouteNames.includes(route.name as string));

const tabs = computed(() => [
  { to: `${routeBase}/deployments`, label: "Deployments", icon: "rocket_launch", active: route.name === "app-deployments" },
  { to: `${routeBase}/logs`, label: "Logs", icon: "article", active: route.name === "app-logs" },
  { to: `${routeBase}/metrics`, label: i18n.global.t("applicationLayout.metricas"), icon: "monitoring", active: route.name === "app-metrics" },
  { to: `${routeBase}/terminal`, label: "Terminal", icon: "terminal", active: route.name === "app-terminal" },
  { to: `${routeBase}/general`, label: i18n.global.t("common.configuration"), icon: "tune", active: isConfigGroup.value },
]);
const subnav = computed(() => [
  { to: `${routeBase}/general`, label: i18n.global.t("common.general"), active: route.name === "app-general" },
  { to: `${routeBase}/source`, label: i18n.global.t("common.origin"), active: route.name === "app-source" },
  { to: `${routeBase}/server`, label: i18n.global.t("common.server"), active: route.name === "app-server" },
  { to: `${routeBase}/env`, label: i18n.global.t("applicationLayout.variaveisDeAmbiente"), active: route.name === "app-env" },
  { to: `${routeBase}/storage`, label: i18n.global.t("common.storage"), active: route.name === "app-storage" },
  { to: `${routeBase}/advanced`, label: i18n.global.t("applicationLayout.avancado"), active: route.name === "app-advanced" },
  { to: `${routeBase}/webhooks`, label: "Webhooks", active: route.name === "app-webhooks" },
  { to: `${routeBase}/previews`, label: "Previews", active: route.name === "app-previews" },
  { to: `${routeBase}/tasks`, label: i18n.global.t("common.scheduledTasks"), active: route.name === "app-tasks" },
  { to: `${routeBase}/operations`, label: i18n.global.t("applicationLayout.operacoes"), active: route.name === "app-operations" },
  { to: `${routeBase}/danger`, label: i18n.global.t("applicationLayout.zonaDePerigo"), active: route.name === "app-danger" },
]);

// The banner compares the saved settings with the last deploy, so refresh it as the user moves around.
watch(
  () => route.fullPath,
  () => void reloadApp().catch(() => undefined),
);

const lifecycleBusy = ref(false);
async function lifecycle(action: ApplicationLifecycleAction) {
  lifecycleBusy.value = true;
  error.value = "";
  try {
    await api.post(`${basePath}/lifecycle`, { action });
    // The worker announces the result over WebSocket; this is the fallback if that socket is down.
    setTimeout(() => void reloadApp().catch(() => undefined), 6000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationLayout.falhaAoExecutarAAcao");
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
  <div v-else-if="!app" class="empty-state">{{ $t("applicationLayout.aplicacaoNaoEncontrada") }}</div>
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
        {{ $t("applicationLayout.iniciar") }}
      </button>
      <template v-else-if="app.status === 'running'">
        <button type="button" class="btn btn-secondary" :disabled="lifecycleBusy" @click="lifecycle('restart')">
          <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
          {{ $t("applicationLayout.reiniciar") }}
        </button>
        <button type="button" class="btn btn-secondary" :disabled="lifecycleBusy" @click="lifecycle('stop')">
          <span class="material-symbols-outlined" style="font-size: 18px">stop</span>
          {{ $t("applicationLayout.parar") }}
        </button>
      </template>
      <button type="button" class="btn" :disabled="deploying" @click="deploy">
        <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
        {{ deploying ? $t("applicationLayout.iniciando") : "Deploy" }}
      </button>
    </template>
    <template #subtitle>
      <p class="resource-subtitle mono">
        <template v-if="app.buildPack === 'image'">{{ app.dockerImage }}</template>
        <template v-else-if="app.buildPack === 'dockerfile_inline'">{{ $t("applicationLayout.dockerfileColado") }}</template>
        <template v-else>{{ app.repoUrl }} ({{ app.branch }}) · {{ app.buildPack }}</template>
        → {{ app.serverName }}:{{ app.port }}
      </p>
      <p v-if="app.domain" class="resource-subtitle">
        <a :href="`https://${app.domain}`" target="_blank" rel="noopener" class="label-link">{{ $t("applicationLayout.httpsP0", { p0: app.domain }) }}</a>
      </p>
    </template>
    <div v-if="app.pendingChanges?.length" class="callout pending-banner" role="status">
      <span class="material-symbols-outlined" style="font-size: 18px">pending_actions</span>
      <div>
        <strong>{{ app.pendingChanges.length }} {{ app.pendingChanges.length === 1 ? $t("applicationLayout.mudancaPendente") : $t("applicationLayout.mudancasPendentes") }}</strong>
        {{ $t("applicationLayout.desdeOUltimoDeployP0", { p0: app.pendingChanges.join(", ") }) }}
        <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" :disabled="deploying" @click="deploy">{{ $t("applicationLayout.fazerDeployPraAplicar") }}</button>
      </div>
    </div>
    <router-view />
  </ResourceDetailShell>
</template>
