<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { server, teamId, error, replaceServer } = useServerContext();

const form = ref({ wildcardDomain: server.value?.wildcardDomain ?? "", acmeEmail: server.value?.acmeEmail ?? "" });
const saving = ref(false);
const activating = ref(false);
const restarting = ref(false);
const logs = ref("");
const logsMessage = ref("");
const containerRunning = ref<boolean | null>(null);
const loadingLogs = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;

async function save() {
  if (!server.value) return;
  saving.value = true;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/domain`, form.value);
    replaceServer(res.server);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar domínio";
  } finally {
    saving.value = false;
  }
}

async function activate() {
  if (!server.value) return;
  activating.value = true;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/proxy`);
    server.value.proxyStatus = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao ativar proxy";
  } finally {
    activating.value = false;
  }
}

async function restart() {
  if (!server.value) return;
  restarting.value = true;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/proxy/restart`);
    server.value.proxyStatus = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao reiniciar o proxy";
  } finally {
    restarting.value = false;
  }
}

async function loadLogs() {
  if (!server.value) return;
  loadingLogs.value = true;
  try {
    const res = await api.get<{ logs: string; running: boolean; message?: string }>(`/teams/${teamId}/servers/${server.value.id}/proxy/logs?tail=300`);
    logs.value = res.logs;
    logsMessage.value = res.message ?? "";
    containerRunning.value = res.running;
  } catch (err) {
    logsMessage.value = err instanceof ApiError ? err.message : "falha ao carregar os logs";
    containerRunning.value = null;
  } finally {
    loadingLogs.value = false;
  }
}

onMounted(() => {
  void loadLogs();
  poll = setInterval(() => void loadLogs(), 10000);
});
onBeforeUnmount(() => clearInterval(poll));
// A fresh activation/restart is worth checking again right away, without waiting for the next tick.
watch(() => server.value?.proxyStatus, (status, prev) => {
  if (prev === "provisioning" && (status === "active" || status === "error")) void loadLogs();
});
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
      Proxy reverso
      <StatusBadge :status="server.proxyStatus" style="margin-left: auto" />
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Ativa um Traefik nesse servidor com HTTPS automático (Let's Encrypt). Sem domínio, o app publica a porta
        direto no host — pode colidir com outras apps.
      </p>
      <div v-if="server.proxyStatus === 'active' && containerRunning === false" class="callout mb-16" style="border-left-color: var(--warn); display: flex; gap: 8px; align-items: flex-start">
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--warn)">warning</span>
        <span>O painel marca o proxy como ativo, mas o container não está rodando neste servidor agora — alguém pode ter parado ou removido ele por fora. Reinicie abaixo.</span>
      </div>
      <div v-else-if="server.proxyStatus === 'error'" class="callout mb-16" style="border-left-color: var(--bad); display: flex; gap: 8px; align-items: flex-start">
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">error</span>
        <span>A última ativação/reinício do proxy falhou. Veja o log abaixo e tente de novo.</span>
      </div>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="wildcard">Domínio wildcard</label>
          <input id="wildcard" v-model="form.wildcardDomain" class="form-control mono" placeholder="apps.meudominio.com" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="acme">E-mail (Let's Encrypt)</label>
          <input id="acme" v-model="form.acmeEmail" class="form-control" placeholder="voce@exemplo.com" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ saving ? "salvando..." : "Salvar" }}
        </button>
        <button type="button" class="btn" :disabled="activating || server.proxyStatus === 'provisioning'" @click="activate">
          <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
          {{ server.proxyStatus === "active" ? "Reativar proxy" : "Ativar proxy" }}
        </button>
        <button
          v-if="server.proxyStatus === 'active' || server.proxyStatus === 'error'"
          type="button"
          class="btn btn-secondary"
          :disabled="restarting"
          @click="restart"
        >
          <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
          {{ restarting ? "reiniciando..." : "Reiniciar" }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      Logs do Traefik
      <button type="button" class="btn btn-secondary btn-sm" style="margin-left: auto" :disabled="loadingLogs" @click="loadLogs">
        <span class="material-symbols-outlined" style="font-size: 16px">refresh</span>
        Atualizar
      </button>
    </div>
    <div class="card-body">
      <p v-if="logsMessage" class="hint" style="margin: 0 0 8px">{{ logsMessage }}</p>
      <pre v-if="logs" class="callout-code" style="max-height: 360px; overflow: auto; margin: 0">{{ logs }}</pre>
      <p v-else-if="!logsMessage && !loadingLogs" class="hint" style="margin: 0">Sem log ainda.</p>
    </div>
  </div>
</template>
