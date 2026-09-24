<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import StatusBadge from "../../components/StatusBadge.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error, reloadApp } = useApplicationContext();
const teamId = useRoute().params.teamId as string;

const servers = ref<ServerDto[]>([]);
const target = ref("");
const busy = ref(false);
const confirming = ref(false);
const forceOffer = ref("");
const moved = ref(false);

onMounted(async () => {
  try {
    servers.value = (await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`)).servers;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar os servidores";
  }
});

const current = () => servers.value.find((s) => s.id === app.value?.serverId);

async function move(force = false) {
  if (!target.value) return;
  if (!confirming.value && !force) {
    confirming.value = true;
    setTimeout(() => (confirming.value = false), 5000);
    return;
  }
  busy.value = true;
  error.value = "";
  forceOffer.value = "";
  try {
    await api.put(`${basePath}/server${force ? "?force=true" : ""}`, { serverId: target.value });
    await reloadApp();
    moved.value = true;
    target.value = "";
  } catch (err) {
    if (err instanceof ApiError && err.code === "teardown_failed") forceOffer.value = err.message;
    else error.value = err instanceof ApiError ? err.message : "falha ao trocar de servidor";
  } finally {
    busy.value = false;
    confirming.value = false;
  }
}
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
      Servidor de destino
    </div>
    <div class="card-body">
      <dl class="kv-list mb-16">
        <div><dt>Servidor atual</dt><dd>{{ app.serverName }} <StatusBadge v-if="current()" :status="current()!.status" /></dd></div>
      </dl>
      <p class="hint mb-16">
        Trocar de servidor <strong>remove</strong> o container, os arquivos e os volumes dessa aplicação do servidor atual e deixa ela parada, sem deploy.
        Os dados dos volumes <strong>não</strong> são copiados pro novo servidor. Depois é só fazer um deploy.
      </p>
      <div v-if="moved" class="alert alert-success mb-16">Pronto — a aplicação está em {{ app.serverName }}. Faça um deploy pra subir lá.</div>
      <div v-if="forceOffer" class="callout mb-16">
        {{ forceOffer }}
        <div class="btn-row" style="margin-top: 8px">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="move(true)">Mover mesmo assim</button>
        </div>
      </div>
      <div class="form-group">
        <label for="target-server">Mover pra</label>
        <select id="target-server" v-model="target" class="form-control">
          <option value="">Escolha um servidor</option>
          <option v-for="s in servers.filter((x) => x.id !== app!.serverId)" :key="s.id" :value="s.id" :disabled="s.status !== 'connected'">
            {{ s.name }}{{ s.status !== "connected" ? " (desconectado)" : "" }}
          </option>
        </select>
      </div>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="busy || !target" @click="move(false)">
        <span class="material-symbols-outlined" style="font-size: 18px">swap_horiz</span>
        {{ confirming ? "Confirmar troca de servidor?" : "Trocar de servidor" }}
      </button>
    </div>
  </div>
</template>
