<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { findServiceCatalogEntry, type ServiceDto, type ServiceStatus, type WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import CodeEditor from "../components/CodeEditor.vue";
import Breadcrumb from "../components/Breadcrumb.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const serviceId = route.params.serviceId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/services/${serviceId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

const service = ref<ServiceDto | null>(null);
const loading = ref(true);
const error = ref("");

const envContent = ref("");
const savingEnv = ref(false);
const envSaved = ref(false);

const domainForm = ref("");
const savingDomain = ref(false);
const domainSaved = ref(false);

const limitsForm = ref<{ memoryLimitMb: number | null; cpuLimit: number | null }>({ memoryLimitMb: null, cpuLimit: null });
const savingLimits = ref(false);
const limitsSaved = ref(false);

const redeploying = ref(false);
const activeSubTab = ref<"general" | "env">("general");

const confirmingDelete = ref(false);
const deleting = ref(false);
let confirmingDeleteTimer: ReturnType<typeof setTimeout> | undefined;

const statusBadge: Record<ServiceStatus, string> = {
  idle: "badge-neutral",
  provisioning: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ service: ServiceDto }>(basePath);
    service.value = res.service;
    envContent.value = res.service.envContent;
    domainForm.value = res.service.domain ?? "";
    limitsForm.value = { memoryLimitMb: res.service.memoryLimitMb, cpuLimit: res.service.cpuLimit };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar serviço";
  } finally {
    loading.value = false;
  }
}

async function saveEnv() {
  savingEnv.value = true;
  envSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ service: ServiceDto }>(`${basePath}/env`, { envContent: envContent.value });
    service.value = res.service;
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
    const res = await api.put<{ service: ServiceDto }>(`${basePath}/domain`, { domain: domainForm.value });
    service.value = res.service;
    domainSaved.value = true;
    setTimeout(() => (domainSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar domínio";
  } finally {
    savingDomain.value = false;
  }
}

async function saveLimits() {
  savingLimits.value = true;
  limitsSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ service: ServiceDto }>(`${basePath}/limits`, {
      memoryLimitMb: limitsForm.value.memoryLimitMb || null,
      cpuLimit: limitsForm.value.cpuLimit || null,
    });
    service.value = res.service;
    limitsSaved.value = true;
    setTimeout(() => (limitsSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar limites";
  } finally {
    savingLimits.value = false;
  }
}

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

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "service.status" && event.serviceId === serviceId && service.value) {
      service.value.status = event.status;
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
        <button type="button" class="detail-subnav-item" :class="{ active: activeSubTab === 'general' }" @click="activeSubTab = 'general'">
          Geral
        </button>
        <button type="button" class="detail-subnav-item" :class="{ active: activeSubTab === 'env' }" @click="activeSubTab = 'env'">
          Variáveis de ambiente
        </button>
      </nav>

      <div v-if="activeSubTab === 'general'" class="card" style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">info</span>
          Geral
        </div>
        <div class="card-body">
          <div class="grid grid-2">
            <div>
              <div class="stat-label">Catálogo</div>
              <div class="mono">{{ service.catalogKey }}</div>
            </div>
            <div>
              <div class="stat-label">Imagem</div>
              <div class="mono">{{ service.image }}</div>
            </div>
            <div>
              <div class="stat-label">Servidor</div>
              <div>{{ service.serverName }}</div>
            </div>
            <div>
              <div class="stat-label">Porta</div>
              <div class="mono">{{ service.port }}</div>
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
            <label for="svc-domain">Domínio customizado</label>
            <input id="svc-domain" v-model="domainForm" class="form-control mono" placeholder="minhaapp.exemplo.com" />
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" :disabled="savingDomain" @click="saveDomain">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingDomain ? "salvando..." : "Salvar" }}
            </button>
            <span v-if="domainSaved" class="muted" style="align-self: center; font-size: 13px">salvo — reimplante pra aplicar</span>
          </div>
        </div>
        <div class="card-header" style="border-top: 1px solid var(--border)">
          <span class="material-symbols-outlined" style="font-size: 18px">speed</span>
          Limites de recurso
        </div>
        <div class="card-body">
          <p class="hint mb-16">Deixe em branco pra não limitar. Reimplante pra aplicar.</p>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="svc-limit-mem">Memória (MB)</label>
              <input id="svc-limit-mem" v-model.number="limitsForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="svc-limit-cpu">CPU (cores)</label>
              <input id="svc-limit-cpu" v-model.number="limitsForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" :disabled="savingLimits" @click="saveLimits">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingLimits ? "salvando..." : "Salvar" }}
            </button>
            <span v-if="limitsSaved" class="muted" style="align-self: center; font-size: 13px">salvo — reimplante pra aplicar</span>
          </div>
        </div>
      </div>

      <div v-else class="card" style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">key</span>
          Variáveis de ambiente
        </div>
        <div class="card-body">
          <CodeEditor v-model="envContent" language="ini" :height="200" />
          <div class="btn-row mt-16" style="margin-top: 12px">
            <button type="button" class="btn btn-secondary" :disabled="savingEnv" @click="saveEnv">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingEnv ? "salvando..." : "Salvar" }}
            </button>
            <span v-if="envSaved" class="muted" style="align-self: center; font-size: 13px">salvo — reimplante pra aplicar</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
