<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ApplicationDto, ApplicationStatus, DeploymentDto, DeploymentStatus, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import CodeEditor from "../components/CodeEditor.vue";
import DeployLogTerminal from "../components/DeployLogTerminal.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const applicationId = route.params.applicationId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/applications/${applicationId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

const app = ref<ApplicationDto | null>(null);
const history = ref<DeploymentDto[]>([]);
const loading = ref(true);
const error = ref("");

const envContent = ref("");
const savingEnv = ref(false);
const envSaved = ref(false);

const domainForm = ref("");
const savingDomain = ref(false);
const domainSaved = ref(false);

const currentDeploymentId = ref<string | null>(null);
const currentLog = ref("");
const currentStatus = ref<DeploymentStatus | null>(null);
const deploying = ref(false);

const statusBadge: Record<ApplicationStatus, string> = {
  idle: "badge-neutral",
  deploying: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};
const deploymentBadge: Record<DeploymentStatus, string> = {
  queued: "badge-neutral",
  running: "badge-warn",
  success: "badge-good",
  failed: "badge-bad",
};

const canDeploy = computed(() => currentStatus.value !== "queued" && currentStatus.value !== "running");

const activeTab = ref<"deployments" | "config">("deployments");
const activeConfigTab = ref<"general" | "env">("general");

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

async function load() {
  loading.value = true;
  try {
    const [appRes, historyRes] = await Promise.all([
      api.get<{ application: ApplicationDto }>(basePath),
      api.get<{ deployments: DeploymentDto[] }>(`${basePath}/deployments`),
    ]);
    app.value = appRes.application;
    envContent.value = appRes.application.envContent;
    domainForm.value = appRes.application.domain ?? "";
    history.value = historyRes.deployments;
    const latest = historyRes.deployments[0];
    if (latest) {
      currentDeploymentId.value = latest.id;
      currentLog.value = latest.log;
      currentStatus.value = latest.status;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar aplicação";
  } finally {
    loading.value = false;
  }
}

async function saveEnv() {
  savingEnv.value = true;
  envSaved.value = false;
  error.value = "";
  try {
    await api.put(`${basePath}/env`, { envContent: envContent.value });
    envSaved.value = true;
    setTimeout(() => (envSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar variáveis";
  } finally {
    savingEnv.value = false;
  }
}

async function saveDomain() {
  savingDomain.value = true;
  domainSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ application: ApplicationDto }>(`${basePath}/domain`, { domain: domainForm.value });
    app.value = res.application;
    domainSaved.value = true;
    setTimeout(() => (domainSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar domínio";
  } finally {
    savingDomain.value = false;
  }
}

async function deploy() {
  deploying.value = true;
  error.value = "";
  try {
    const res = await api.post<{ deployment: DeploymentDto }>(`${basePath}/deploy`, {});
    currentDeploymentId.value = res.deployment.id;
    currentLog.value = "";
    currentStatus.value = res.deployment.status;
    history.value = [res.deployment, ...history.value];
    if (app.value) app.value.status = "deploying";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar deploy";
  } finally {
    deploying.value = false;
  }
}

function selectDeployment(deployment: DeploymentDto) {
  currentDeploymentId.value = deployment.id;
  currentLog.value = deployment.log;
  currentStatus.value = deployment.status;
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "deployment.log" && event.deploymentId === currentDeploymentId.value) {
      currentLog.value += event.line;
    }
    if (event.type === "deployment.status" && event.deploymentId === currentDeploymentId.value) {
      currentStatus.value = event.status;
      const historyEntry = history.value.find((d) => d.id === event.deploymentId);
      if (historyEntry) historyEntry.status = event.status;
      if (app.value) {
        if (event.status === "success") app.value.status = "running";
        if (event.status === "failed") app.value.status = "error";
      }
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
  clearTimeout(confirmingDeleteTimer);
});
</script>

<template>
  <div v-if="loading" class="empty-state">carregando...</div>
  <div v-else-if="!app" class="empty-state">Aplicação não encontrada.</div>
  <div v-else>
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
        <button type="button" class="btn" :disabled="deploying || !canDeploy" @click="deploy">
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
      <button type="button" class="detail-tab" :class="{ active: activeTab === 'deployments' }" @click="activeTab = 'deployments'">
        <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
        Deployments
      </button>
      <button type="button" class="detail-tab" :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">
        <span class="material-symbols-outlined" style="font-size: 18px">tune</span>
        Configuration
      </button>
    </div>

    <template v-if="activeTab === 'deployments'">
      <div class="card mb-16">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
          Log do deploy
          <span v-if="currentStatus" class="badge" :class="deploymentBadge[currentStatus]" style="margin-left: auto">
            {{ currentStatus }}
          </span>
        </div>
        <DeployLogTerminal :log="currentLog" />
      </div>

      <div class="card">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">history</span>
          Histórico de deploys
        </div>
        <div v-if="history.length === 0" class="card-body">
          <div class="empty-state">Nenhum deploy ainda.</div>
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="deployment in history" :key="deployment.id">
                <td>{{ new Date(deployment.createdAt).toLocaleString("pt-BR") }}</td>
                <td><span class="badge" :class="deploymentBadge[deployment.status]">{{ deployment.status }}</span></td>
                <td>
                  <button type="button" class="btn btn-secondary btn-sm" @click="selectDeployment(deployment)">
                    Ver log
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <div v-else class="detail-layout">
      <nav class="detail-subnav">
        <button type="button" class="detail-subnav-item" :class="{ active: activeConfigTab === 'general' }" @click="activeConfigTab = 'general'">
          Geral
        </button>
        <button type="button" class="detail-subnav-item" :class="{ active: activeConfigTab === 'env' }" @click="activeConfigTab = 'env'">
          Variáveis de ambiente
        </button>
      </nav>

      <div class="card" v-if="activeConfigTab === 'general'" style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">info</span>
          Geral
        </div>
        <div class="card-body">
          <div class="grid grid-2">
            <div>
              <div class="stat-label">Repositório</div>
              <div class="mono">{{ app.repoUrl }}</div>
            </div>
            <div>
              <div class="stat-label">Branch</div>
              <div class="mono">{{ app.branch }}</div>
            </div>
            <div>
              <div class="stat-label">Servidor</div>
              <div>{{ app.serverName }}</div>
            </div>
            <div>
              <div class="stat-label">Porta</div>
              <div class="mono">{{ app.port }}</div>
            </div>
            <div>
              <div class="stat-label">Build pack</div>
              <div class="mono">{{ app.buildPack }}</div>
            </div>
          </div>
        </div>
        <div class="card-header" style="border-top: 1px solid var(--border)">
          <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
          Domínio
        </div>
        <div class="card-body">
          <p class="hint mb-16">
            Deixe em branco pra usar o domínio wildcard do servidor (se o proxy estiver ativo) ou publicar a porta direto no host.
          </p>
          <div class="form-group">
            <label for="app-domain">Domínio customizado</label>
            <input id="app-domain" v-model="domainForm" class="form-control mono" placeholder="minhaapp.exemplo.com" />
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" :disabled="savingDomain" @click="saveDomain">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingDomain ? "salvando..." : "Salvar" }}
            </button>
            <span v-if="domainSaved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
          </div>
        </div>
      </div>

      <div class="card" v-else style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">key</span>
          Variáveis de ambiente
        </div>
        <div class="card-body">
          <CodeEditor v-model="envContent" language="ini" :height="200" />
          <div class="btn-row mt-16" style="margin-top: 12px">
            <button type="button" class="btn btn-secondary" :disabled="savingEnv" @click="saveEnv">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingEnv ? "salvando..." : "Salvar variáveis" }}
            </button>
            <span v-if="envSaved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
