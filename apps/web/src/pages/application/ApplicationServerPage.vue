<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import StatusBadge from "../../components/StatusBadge.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationServer.falhaAoCarregarOsServidores");
  }
});

const current = () => servers.value.find((s) => s.id === app.value?.serverId);
const onLocalMachine = () => current()?.isPlatformHost === true;

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
    else error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationServer.falhaAoTrocarDeServidor");
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
      {{ $t("applicationServer.servidorDeDestino") }}
    </div>
    <div class="card-body">
      <dl class="kv-list mb-16">
        <div><dt>{{ $t("applicationServer.servidorAtual") }}</dt><dd>{{ app.serverName }} <StatusBadge v-if="current()" :status="current()!.status" /></dd></div>
      </dl>
      <div v-if="onLocalMachine()" class="callout mb-16">
        {{ $t("applicationServer.estaAplicacaoRodaNaMaquina") }} <strong>{{ $t("applicationServer.promoveLa") }}</strong>{{ $t("applicationServer.facaBackupDosVolumesAntes") }}
      </div>
      <p class="hint mb-16">
        {{ $t("applicationServer.trocarDeServidor") }} <strong>{{ $t("applicationServer.remove") }}</strong> {{ $t("applicationServer.oContainerOsArquivosE") }} <strong>{{ $t("applicationServer.nao") }}</strong> {{ $t("applicationServer.saoCopiadosProNovoServidor") }}
      </p>
      <div v-if="moved" class="alert alert-success mb-16">{{ $t("applicationServer.prontoAAplicacaoEstaEm", { p0: app.serverName }) }}</div>
      <div v-if="forceOffer" class="callout mb-16">
        {{ forceOffer }}
        <div class="btn-row" style="margin-top: 8px">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="move(true)">{{ $t("applicationServer.moverMesmoAssim") }}</button>
        </div>
      </div>
      <div class="form-group">
        <label for="target-server">{{ $t("applicationServer.moverPra") }}</label>
        <select id="target-server" v-model="target" class="form-control">
          <option value="">{{ $t("applicationServer.escolhaUmServidor") }}</option>
          <option v-for="s in servers.filter((x) => x.id !== app!.serverId)" :key="s.id" :value="s.id" :disabled="s.status !== 'connected'">
            {{ s.name }}{{ s.status !== "connected" ? " (desconectado)" : "" }}
          </option>
        </select>
      </div>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="busy || !target" @click="move(false)">
        <span class="material-symbols-outlined" style="font-size: 18px">swap_horiz</span>
        {{ confirming ? $t("applicationServer.confirmarTrocaDeServidor") : onLocalMachine() ? $t("applicationServer.promoverPraServidorReal") : $t("applicationServer.trocarDeServidor") }}
      </button>
    </div>
  </div>
</template>
