<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ServiceVolumeDto, VolumeBackupDto } from "@yeah/shared";
import StatusBadge from "../../components/StatusBadge.vue";
import { api, ApiError } from "../../lib/api";
import { useServiceContext } from "../../composables/useServiceContext";

const { basePath, error } = useServiceContext();

const volumes = ref<ServiceVolumeDto[]>([]);
const backups = ref<VolumeBackupDto[]>([]);
const loaded = ref(false);
const openLogId = ref<string | null>(null);
const confirmingRestore = ref("");
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
const busy = computed(() => backups.value.some((b) => b.status === "queued" || b.status === "running"));

async function loadBackups() {
  try {
    backups.value = (await api.get<{ backups: VolumeBackupDto[] }>(`${basePath}/volume-backups`)).backups;
  } catch {
    /* next poll */
  }
}

async function load() {
  try {
    volumes.value = (await api.get<{ volumes: ServiceVolumeDto[] }>(`${basePath}/volumes`)).volumes;
    await loadBackups();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar os volumes";
  } finally {
    loaded.value = true;
  }
}

async function backupVolume(v: ServiceVolumeDto) {
  error.value = "";
  try {
    await api.post(`${basePath}/volumes/${encodeURIComponent(v.key)}/backup`, {});
    await loadBackups();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar o backup";
  }
}

async function restoreBackup(b: VolumeBackupDto) {
  if (confirmingRestore.value !== b.id) {
    confirmingRestore.value = b.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingRestore.value = ""), 4000);
    return;
  }
  confirmingRestore.value = "";
  error.value = "";
  try {
    await api.post(`${basePath}/volume-backups/${b.id}/restore`, {});
    await loadBackups();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar o restore";
  }
}

async function deleteBackup(b: VolumeBackupDto) {
  try {
    await api.delete(`${basePath}/volume-backups/${b.id}`);
    backups.value = backups.value.filter((x) => x.id !== b.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir";
  }
}

const downloadUrl = (id: string) => `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}${basePath}/volume-backups/${id}/download`;
const size = (n: number | null) => (!n ? "-" : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

onMounted(() => {
  void load();
  poll = setInterval(() => {
    if (busy.value) void loadBackups();
  }, 3000);
});
onBeforeUnmount(() => {
  clearInterval(poll);
  clearTimeout(confirmTimer);
});
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
      Volumes e backups
    </div>
    <div class="card-body">
      <p class="hint" style="margin: 0">
        <strong>Volume persistente não é backup:</strong> ele sobrevive a redeploys, mas se o servidor morrer ou o serviço for excluído, os dados vão junto.
        "Backup" cria um <span class="mono">.tar.gz</span> do conteúdo do volume, no servidor (guardamos os 5 mais recentes de cada). Restaurar
        <strong>substitui</strong> o conteúdo do volume e reinicia os containers da stack. Baixe os arquivos pra guardá-los fora do servidor.
      </p>
    </div>
    <div v-if="loaded && volumes.length === 0" class="card-body">
      <p class="hint" style="margin: 0">O compose deste serviço não declara volumes nomeados (a chave <span class="mono">volumes:</span> no nível de cima), então não há o que copiar.</p>
    </div>
    <div v-else-if="volumes.length" class="table-wrap">
      <table>
        <thead><tr><th>Volume</th><th>Nome no Docker</th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in volumes" :key="v.key">
            <td class="mono">{{ v.key }}</td>
            <td class="mono">{{ v.dockerName }}</td>
            <td><button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="backupVolume(v)">Backup</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="backups.length" class="card" style="margin-top: 16px">
    <div class="card-header">Histórico</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Quando</th><th>Volume</th><th>Operação</th><th>Status</th><th>Tamanho</th><th></th></tr></thead>
        <tbody>
          <template v-for="b in backups" :key="b.id">
            <tr>
              <td>{{ new Date(b.createdAt).toLocaleString("pt-BR") }}</td>
              <td class="mono">{{ b.label }}</td>
              <td>{{ b.operation === "backup" ? "backup" : "restore" }}</td>
              <td><StatusBadge :status="b.status" kind="job" /></td>
              <td class="mono">{{ size(b.sizeBytes) }}</td>
              <td>
                <div class="btn-row">
                  <template v-if="b.operation === 'backup' && b.status === 'success'">
                    <a class="btn btn-secondary btn-sm" :href="downloadUrl(b.id)">Baixar</a>
                    <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="restoreBackup(b)">{{ confirmingRestore === b.id ? "Substituir os dados?" : "Restaurar" }}</button>
                  </template>
                  <button type="button" class="btn btn-secondary btn-sm" @click="openLogId = openLogId === b.id ? null : b.id">Log</button>
                  <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteBackup(b)">Excluir</button>
                </div>
              </td>
            </tr>
            <tr v-if="openLogId === b.id"><td colspan="6"><pre class="callout-code" style="max-height: 240px; overflow: auto; margin: 0">{{ b.log || "(sem saída ainda)" }}</pre></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
