<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { server, teamId, error } = useServerContext();
const router = useRouter();
const testing = ref(false);
const sshTimeout = ref(server.value?.sshTimeoutSeconds ?? 15);
const savingTimeout = ref(false);
const timeoutSaved = ref(false);

async function saveTimeout() {
  if (!server.value) return;
  savingTimeout.value = true;
  timeoutSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ server: { sshTimeoutSeconds: number } }>(`/teams/${teamId}/servers/${server.value.id}/ssh`, { sshTimeoutSeconds: sshTimeout.value });
    server.value.sshTimeoutSeconds = res.server.sshTimeoutSeconds;
    timeoutSaved.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar o timeout";
  } finally {
    savingTimeout.value = false;
  }
}

const confirmingRemove = ref(false);
const removing = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(confirmTimer));

async function removeServer() {
  if (!server.value) return;
  if (!confirmingRemove.value) {
    confirmingRemove.value = true;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingRemove.value = false), 4000);
    return;
  }
  removing.value = true;
  error.value = "";
  try {
    await api.delete(`/teams/${teamId}/servers/${server.value.id}`);
    router.push(`/teams/${teamId}/servers`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover o servidor";
    confirmingRemove.value = false;
    removing.value = false;
  }
}

async function testConnection() {
  if (!server.value) return;
  testing.value = true;
  server.value.status = "pending";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/test-connection`);
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Detalhes
    </div>
    <div class="card-body">
      <dl class="kv-list">
        <div><dt>Endereço</dt><dd class="mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</dd></div>
        <div><dt>Status</dt><dd><StatusBadge :status="server.status" /></dd></div>
        <div><dt>Docker</dt><dd class="mono">{{ server.dockerVersion || "-" }}</dd></div>
        <div>
          <dt>Última checagem</dt>
          <dd>{{ server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString("pt-BR") : "-" }}</dd>
        </div>
        <div><dt>Proxy</dt><dd><StatusBadge :status="server.proxyStatus" /></dd></div>
      </dl>
      <div class="btn-row" style="margin-top: 16px">
        <button type="button" class="btn btn-secondary" :disabled="testing" @click="testConnection">
          <span class="material-symbols-outlined" style="font-size: 18px">sync</span>
          Testar conexão
        </button>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">timer</span>
      Conexão SSH
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Quanto tempo o painel espera o servidor responder ao conectar antes de desistir. Aumente pra máquinas lentas ou muito distantes.
      </p>
      <form class="form-group" @submit.prevent="saveTimeout">
        <label for="ssh-timeout">Timeout de conexão (segundos)</label>
        <input id="ssh-timeout" v-model.number="sshTimeout" type="number" min="5" max="120" class="form-control" style="max-width: 160px" />
        <div class="btn-row" style="margin-top: 12px">
          <button type="submit" class="btn btn-secondary" :disabled="savingTimeout">Salvar</button>
          <span v-if="timeoutSaved" class="hint">Salvo.</span>
        </div>
      </form>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">warning</span>
      Remover servidor
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Tira o servidor do painel; nada é apagado na máquina (containers, proxy e arquivos ficam lá). Só dá pra remover quando
        não houver aplicação, banco ou serviço nele.
      </p>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="removing" @click="removeServer">
        <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
        {{ confirmingRemove ? "Confirmar remoção?" : "Remover servidor" }}
      </button>
    </div>
  </div>
</template>
