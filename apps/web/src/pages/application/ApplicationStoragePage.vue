<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ApplicationVolumeDto, VolumeBackupDto, VolumeKind } from "@yeah/shared";
import StatusBadge from "../../components/StatusBadge.vue";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error, reloadApp } = useApplicationContext();

const volumes = ref<ApplicationVolumeDto[]>([]);
const kind = ref<VolumeKind>("volume");
const name = ref("");
const mountPath = ref("");
const hostPath = ref("");
const fileContent = ref("");
const adding = ref(false);
const deletingId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editContent = ref("");

const kindLabels: Record<VolumeKind, string> = { volume: "Volume Docker", bind: "Diretório do servidor", file: "Arquivo" };

async function load() {
  try {
    volumes.value = (await api.get<{ volumes: ApplicationVolumeDto[] }>(`${basePath}/volumes`)).volumes;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar armazenamento";
  }
}
// ---- backups of the volumes' contents
const backups = ref<VolumeBackupDto[]>([]);
const openLogId = ref<string | null>(null);
const confirmingRestore = ref("");
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
const backupBusy = computed(() => backups.value.some((b) => b.status === "queued" || b.status === "running"));

async function loadBackups() {
  try {
    backups.value = (await api.get<{ backups: VolumeBackupDto[] }>(`${basePath}/volume-backups`)).backups;
  } catch {
    /* next poll */
  }
}

async function backupVolume(volume: ApplicationVolumeDto) {
  error.value = "";
  try {
    await api.post(`${basePath}/volumes/${volume.id}/backup`, {});
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
  void loadBackups();
  poll = setInterval(() => {
    if (backupBusy.value) void loadBackups();
  }, 3000);
});
onBeforeUnmount(() => {
  clearInterval(poll);
  clearTimeout(confirmTimer);
});

const canAdd = () =>
  name.value.trim() && mountPath.value.trim() && (kind.value !== "bind" || hostPath.value.trim()) && (kind.value !== "file" || fileContent.value.length > 0);

async function add() {
  if (!canAdd()) return;
  adding.value = true;
  error.value = "";
  try {
    const res = await api.post<{ volume: ApplicationVolumeDto }>(`${basePath}/volumes`, {
      name: name.value.trim(),
      mountPath: mountPath.value.trim(),
      kind: kind.value,
      ...(kind.value === "bind" ? { hostPath: hostPath.value.trim() } : {}),
      ...(kind.value === "file" ? { fileContent: fileContent.value } : {}),
    });
    volumes.value = [...volumes.value, res.volume];
    name.value = mountPath.value = hostPath.value = fileContent.value = "";
    void reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao adicionar armazenamento";
  } finally {
    adding.value = false;
  }
}

async function remove(id: string) {
  deletingId.value = id;
  error.value = "";
  try {
    await api.delete(`${basePath}/volumes/${id}`);
    volumes.value = volumes.value.filter((v) => v.id !== id);
    void reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover armazenamento";
  } finally {
    deletingId.value = null;
  }
}

function startEdit(v: ApplicationVolumeDto) {
  editingId.value = v.id;
  editContent.value = v.fileContent ?? "";
}

async function saveEdit(v: ApplicationVolumeDto) {
  error.value = "";
  try {
    const res = await api.put<{ volume: ApplicationVolumeDto }>(`${basePath}/volumes/${v.id}`, { fileContent: editContent.value });
    volumes.value = volumes.value.map((x) => (x.id === v.id ? res.volume : x));
    editingId.value = null;
    void reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar o arquivo";
  }
}
</script>

<template>
  <div class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">hard_drive</span>
      Armazenamento persistente
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Aplica no próximo deploy. <strong>Volume persistente não é backup:</strong> ele sobrevive a redeploys, mas se o servidor morrer ou a aplicação for excluída, os dados vão junto.
      </p>
      <p v-if="app?.buildPack === 'docker_compose'" class="hint mb-16">Em aplicações Docker Compose vale o que o arquivo compose declara — esta lista não é usada.</p>
      <div v-if="volumes.length === 0" class="empty-state">Nada configurado.</div>
      <div v-else class="table-wrap mb-16">
        <table>
          <thead>
            <tr><th>Tipo</th><th>Nome</th><th>No container</th><th>Origem</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="v in volumes" :key="v.id">
              <tr>
                <td>{{ kindLabels[v.kind] }}</td>
                <td>{{ v.name }}</td>
                <td class="mono">{{ v.mountPath }}</td>
                <td class="mono">{{ v.kind === "bind" ? v.hostPath : v.kind === "file" ? `${(v.fileContent ?? "").length} caracteres` : "gerenciado pelo Docker" }}</td>
                <td>
                  <div class="btn-row">
                    <button v-if="app?.buildPack !== 'docker_compose'" type="button" class="btn btn-secondary btn-sm" :disabled="backupBusy" @click="backupVolume(v)">Backup</button>
                    <button v-if="v.kind === 'file'" type="button" class="btn btn-secondary btn-sm" @click="startEdit(v)">Editar</button>
                    <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" :disabled="deletingId === v.id" @click="remove(v.id)">
                      {{ deletingId === v.id ? "removendo..." : "Remover" }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="editingId === v.id">
                <td colspan="5">
                  <textarea v-model="editContent" class="form-control mono" rows="8" :aria-label="`Conteúdo de ${v.mountPath}`"></textarea>
                  <div class="btn-row" style="margin-top: 8px">
                    <button type="button" class="btn btn-secondary btn-sm" @click="saveEdit(v)">Salvar arquivo</button>
                    <button type="button" class="btn btn-secondary btn-sm" @click="editingId = null">Cancelar</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="form-group">
        <label for="vol-kind">Tipo</label>
        <select id="vol-kind" v-model="kind" class="form-control" style="max-width: 280px">
          <option value="volume">Volume Docker (dados persistentes)</option>
          <option value="bind">Diretório do servidor</option>
          <option value="file">Arquivo (conteúdo guardado no painel)</option>
        </select>
        <p class="hint" style="margin-top: 6px">
          <template v-if="kind === 'volume'">O Docker gerencia o volume; o nome é só um rótulo.</template>
          <template v-if="kind === 'bind'">Monta uma pasta que já existe (ou será criada) no servidor — útil pra compartilhar dados com o host ou com outra aplicação.</template>
          <template v-if="kind === 'file'">O conteúdo (criptografado no painel) é escrito no servidor a cada deploy e montado como arquivo — bom pra config, certificado, <span class="mono">.htpasswd</span>.</template>
        </p>
      </div>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="vol-name">Nome</label>
          <input id="vol-name" v-model="name" class="form-control" placeholder="uploads" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="vol-path">Caminho no container</label>
          <input id="vol-path" v-model="mountPath" class="form-control mono" placeholder="/app/uploads" />
        </div>
      </div>
      <div v-if="kind === 'bind'" class="form-group">
        <label for="vol-host">Diretório no servidor</label>
        <input id="vol-host" v-model="hostPath" class="form-control mono" placeholder="/srv/dados" />
      </div>
      <div v-if="kind === 'file'" class="form-group">
        <label for="vol-content">Conteúdo do arquivo</label>
        <textarea id="vol-content" v-model="fileContent" class="form-control mono" rows="6"></textarea>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="adding || !canAdd()" @click="add">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ adding ? "adicionando..." : "Adicionar" }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="app && app.buildPack !== 'docker_compose' && (backups.length > 0 || volumes.length > 0)" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
      Backups do armazenamento
    </div>
    <div class="card-body">
      <p class="hint" style="margin: 0">
        "Backup" numa linha acima cria um <span class="mono">.tar.gz</span> do conteúdo daquele volume, no servidor (guardamos os 5 mais recentes de cada). Restaurar
        <strong>substitui</strong> o conteúdo atual do volume e reinicia a aplicação. Baixe os arquivos pra guardá-los fora do servidor.
      </p>
    </div>
    <div v-if="backups.length" class="table-wrap">
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
                    <button type="button" class="btn btn-secondary btn-sm" :disabled="backupBusy" @click="restoreBackup(b)">{{ confirmingRestore === b.id ? "Substituir os dados?" : "Restaurar" }}</button>
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
