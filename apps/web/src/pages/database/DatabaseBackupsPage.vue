<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { DATABASE_ENGINES, type BackupExecutionDto, type BackupScheduleDto, type DatabaseRestoreDto, type S3StorageDto, type WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { wsClient } from "../../lib/ws";
import { useDatabaseContext } from "../../composables/useDatabaseContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { database, basePath, error } = useDatabaseContext();
const multiDatabase = computed(() => database.value !== null && ['postgresql', 'mysql', 'mariadb', 'mongodb'].includes(database.value.engine));
const engineInfo = computed(() => (database.value ? DATABASE_ENGINES[database.value.engine] : null));
const route = useRoute();
const teamId = route.params.teamId as string;

const schedule = ref<BackupScheduleDto | null>(null);
const executions = ref<BackupExecutionDto[]>([]);
const storages = ref<S3StorageDto[]>([]);

const scheduleForm = ref({
  cron: "0 0 * * *",
  timezone: "UTC",
  timeoutSeconds: 3600,
  retentionCount: 7,
  retentionDays: 0,
  retentionSizeGb: 0,
  storageId: "" as string | "",
  databases: "",
});
const creatingSchedule = ref(false);
const runningNow = ref(false);
const editingSchedule = ref(false);
const editForm = ref({
  cron: "",
  timezone: "",
  timeoutSeconds: 3600,
  retentionCount: 7,
  retentionDays: 0,
  retentionSizeGb: 0,
  storageId: "" as string | "",
  databases: "",
});
const savingSchedule = ref(false);

function formatSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadExecutions() {
  const res = await api.get<{ executions: BackupExecutionDto[] }>(`${basePath}/backup-executions`);
  executions.value = res.executions;
}

async function load() {
  try {
    const [scheduleRes, storagesRes] = await Promise.all([
      api.get<{ schedule: BackupScheduleDto | null }>(`${basePath}/backup-schedule`),
      api.get<{ storages: S3StorageDto[] }>(`/teams/${teamId}/storages`),
    ]);
    schedule.value = scheduleRes.schedule;
    storages.value = storagesRes.storages;
    if (schedule.value) await loadExecutions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar backups";
  }
}

async function createSchedule() {
  creatingSchedule.value = true;
  error.value = "";
  try {
    const res = await api.post<{ schedule: BackupScheduleDto }>(`${basePath}/backup-schedule`, {
      ...scheduleForm.value,
      storageId: scheduleForm.value.storageId || null,
      databases: scheduleForm.value.databases.trim() || null,
    });
    schedule.value = res.schedule;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar agendamento";
  } finally {
    creatingSchedule.value = false;
  }
}

const confirming = ref("");
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
/** Two-step buttons: the first click arms, the second (within 4 s) does it. */
function armed(key: string): boolean {
  if (confirming.value === key) {
    confirming.value = "";
    return true;
  }
  confirming.value = key;
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => (confirming.value = ""), 4000);
  return false;
}

async function deleteSchedule(withBackups: boolean) {
  if (!schedule.value || !armed(withBackups ? "schedule+files" : "schedule")) return;
  try {
    await api.delete(`${basePath}/backup-schedule/${schedule.value.id}${withBackups ? "?withBackups=true" : ""}`);
    schedule.value = null;
    executions.value = [];
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover";
  }
}

const cleaning = ref(false);
const cleanupMessage = ref("");
async function cleanup(what: "failed" | "missing") {
  cleaning.value = true;
  cleanupMessage.value = "";
  error.value = "";
  try {
    const res = await api.post<{ removed: number }>(`${basePath}/backup-executions/cleanup`, { what });
    cleanupMessage.value = res.removed === 0 ? "Nada pra limpar." : `${res.removed} removido(s).`;
    await loadExecutions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha na limpeza";
  } finally {
    cleaning.value = false;
  }
}

// ---- restore / import
const restores = ref<DatabaseRestoreDto[]>([]);
const openRestoreId = ref<string | null>(null);
const uploading = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);
let restorePoll: ReturnType<typeof setInterval> | undefined;

async function loadRestores() {
  try {
    restores.value = (await api.get<{ restores: DatabaseRestoreDto[] }>(`${basePath}/restores`)).restores;
  } catch {
    /* next poll */
  }
}

const restoreRunning = computed(() => restores.value.some((r) => r.status === "queued" || r.status === "running"));

async function restoreFrom(execution: BackupExecutionDto) {
  if (!armed(`restore-${execution.id}`)) return;
  error.value = "";
  try {
    const res = await api.post<{ restore: DatabaseRestoreDto }>(`${basePath}/backup-executions/${execution.id}/restore`, {});
    openRestoreId.value = res.restore.id;
    await loadRestores();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar o restore";
  }
}

async function uploadAndRestore(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!armed(`upload-${file.name}`)) {
    // First selection only arms: the file input is reset so choosing it again confirms.
    error.value = `Isto vai SUBSTITUIR os dados do banco pelo conteúdo de "${file.name}". Escolha o arquivo de novo pra confirmar.`;
    input.value = "";
    return;
  }
  error.value = "";
  uploading.value = true;
  try {
    const base = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}${basePath}/restore-upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const json = (await res.json().catch(() => ({}))) as { restore?: DatabaseRestoreDto; error?: string };
    if (!res.ok || !json.restore) throw new Error(json.error ?? `HTTP ${res.status}`);
    openRestoreId.value = json.restore.id;
    await loadRestores();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "falha ao enviar o arquivo";
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

function startEditSchedule() {
  if (!schedule.value) return;
  editForm.value = {
    cron: schedule.value.cron,
    timezone: schedule.value.timezone,
    timeoutSeconds: schedule.value.timeoutSeconds,
    retentionCount: schedule.value.retentionCount,
    retentionDays: schedule.value.retentionDays,
    retentionSizeGb: schedule.value.retentionSizeGb,
    storageId: schedule.value.storageId ?? "",
    databases: schedule.value.databases ?? "",
  };
  editingSchedule.value = true;
}

async function saveSchedule() {
  if (!schedule.value) return;
  savingSchedule.value = true;
  error.value = "";
  try {
    const res = await api.put<{ schedule: BackupScheduleDto }>(`${basePath}/backup-schedule/${schedule.value.id}`, {
      ...editForm.value,
      storageId: editForm.value.storageId || null,
      databases: editForm.value.databases.trim() || null,
    });
    schedule.value = res.schedule;
    editingSchedule.value = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar agendamento";
  } finally {
    savingSchedule.value = false;
  }
}

async function runNow() {
  if (!schedule.value) return;
  runningNow.value = true;
  try {
    await api.post(`${basePath}/backup-schedule/${schedule.value.id}/run-now`, {});
    await loadExecutions();
  } finally {
    runningNow.value = false;
  }
}

async function deleteExecution(executionId: string) {
  await api.delete(`${basePath}/backup-executions/${executionId}`);
  executions.value = executions.value.filter((e) => e.id !== executionId);
}

function downloadUrl(executionId: string): string {
  const base = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
  return `${base}${basePath}/backup-executions/${executionId}/download`;
}

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  load();
  void loadRestores();
  restorePoll = setInterval(() => {
    if (restoreRunning.value) void loadRestores();
  }, 3000);
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "backup.status" && schedule.value && event.scheduleId === schedule.value.id) {
      loadExecutions();
    }
  });
});
onUnmounted(() => {
  clearInterval(restorePoll);
  clearTimeout(confirmTimer);
  unsubscribe?.();
});
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
      Backups
    </div>

    <div v-if="!schedule" class="card-body">
      <p class="hint mb-16">Sem agendamento ainda. Crie um pra ter backups automáticos deste banco.</p>
      <form @submit.prevent="createSchedule">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="cron">Frequência (cron)</label>
            <input id="cron" v-model="scheduleForm.cron" class="form-control mono" placeholder="0 0 * * *" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="tz">Timezone</label>
            <input id="tz" v-model="scheduleForm.timezone" class="form-control" placeholder="UTC" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="timeout">Timeout (s)</label>
            <input id="timeout" v-model.number="scheduleForm.timeoutSeconds" type="number" class="form-control" />
          </div>
        </div>
        <p class="hint mb-16">Retenção — 0 significa sem limite naquela regra; a primeira que bater dispara a limpeza.</p>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="retention-count">Nº de backups a manter</label>
            <input id="retention-count" v-model.number="scheduleForm.retentionCount" type="number" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="retention-days">Dias a manter</label>
            <input id="retention-days" v-model.number="scheduleForm.retentionDays" type="number" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="retention-size">Armazenamento máx. (GB)</label>
            <input id="retention-size" v-model.number="scheduleForm.retentionSizeGb" type="number" class="form-control" />
          </div>
        </div>
        <div v-if="multiDatabase" class="form-group">
          <label for="inc">Bancos a incluir</label>
          <input id="inc" v-model="scheduleForm.databases" class="form-control mono" placeholder="em branco = só o banco principal; ou: vendas, estoque" />
          <p class="hint" style="margin-top: 6px">Nomes separados por vírgula. Com mais de um, o backup vira um arquivo <span class="mono">.tar.gz</span> com um dump por banco.</p>
        </div>
        <div class="form-group">
          <label for="storage">Destino</label>
          <select id="storage" v-model="scheduleForm.storageId" class="form-control">
            <option value="">Disco do servidor</option>
            <option v-for="s in storages" :key="s.id" :value="s.id">{{ s.name }} ({{ s.bucket }})</option>
          </select>
        </div>
        <button type="submit" class="btn" :disabled="creatingSchedule">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ creatingSchedule ? "criando..." : "Criar agendamento" }}
        </button>
      </form>
    </div>

    <template v-else>
      <div v-if="!editingSchedule" class="card-body" style="border-bottom: 1px solid var(--border)">
        <div class="btn-row mb-16">
          <span class="mono" style="align-self: center">{{ schedule.cron }} ({{ schedule.timezone }})</span>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="runningNow" @click="runNow">
            <span class="material-symbols-outlined" style="font-size: 16px">bolt</span>
            {{ runningNow ? "disparando..." : "Backup agora" }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="startEditSchedule">
            <span class="material-symbols-outlined" style="font-size: 16px">edit</span>
            Editar
          </button>
          <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteSchedule(false)">
            <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
            {{ confirming === "schedule" ? "Confirmar?" : "Remover agendamento" }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteSchedule(true)">
            <span class="material-symbols-outlined" style="font-size: 16px">delete_forever</span>
            {{ confirming === "schedule+files" ? "Apagar tudo mesmo?" : "Remover e apagar os backups" }}
          </button>
        </div>
        <p class="hint">
          Retenção: {{ schedule.retentionCount || "∞" }} backups · {{ schedule.retentionDays || "∞" }} dias ·
          {{ schedule.retentionSizeGb || "∞" }} GB
        </p>
        <p v-if="schedule.databases" class="hint">Bancos: <span class="mono">{{ schedule.databases }}</span></p>
        <p class="hint">
          Destino: {{ schedule.storageId ? storages.find((s) => s.id === schedule?.storageId)?.name ?? "S3" : "disco do servidor" }}
        </p>
      </div>

      <div v-else class="card-body" style="border-bottom: 1px solid var(--border)">
        <form @submit.prevent="saveSchedule">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-cron">Frequência (cron)</label>
              <input id="edit-cron" v-model="editForm.cron" class="form-control mono" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-tz">Timezone</label>
              <input id="edit-tz" v-model="editForm.timezone" class="form-control" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-timeout">Timeout (s)</label>
              <input id="edit-timeout" v-model.number="editForm.timeoutSeconds" type="number" class="form-control" />
            </div>
          </div>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-retention-count">Nº de backups a manter</label>
              <input id="edit-retention-count" v-model.number="editForm.retentionCount" type="number" class="form-control" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-retention-days">Dias a manter</label>
              <input id="edit-retention-days" v-model.number="editForm.retentionDays" type="number" class="form-control" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-retention-size">Armazenamento máx. (GB)</label>
              <input id="edit-retention-size" v-model.number="editForm.retentionSizeGb" type="number" class="form-control" />
            </div>
          </div>
          <div v-if="multiDatabase" class="form-group">
            <label for="edit-inc">Bancos a incluir</label>
            <input id="edit-inc" v-model="editForm.databases" class="form-control mono" placeholder="em branco = só o banco principal; ou: vendas, estoque" />
            <p class="hint" style="margin-top: 6px">Nomes separados por vírgula. Com mais de um, o backup vira um arquivo <span class="mono">.tar.gz</span> com um dump por banco.</p>
          </div>
            <div class="form-group">
            <label for="edit-storage">Destino</label>
            <select id="edit-storage" v-model="editForm.storageId" class="form-control">
              <option value="">Disco do servidor</option>
              <option v-for="s in storages" :key="s.id" :value="s.id">{{ s.name }} ({{ s.bucket }})</option>
            </select>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="savingSchedule">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingSchedule ? "salvando..." : "Salvar" }}
            </button>
            <button type="button" class="btn btn-secondary" @click="editingSchedule = false">Cancelar</button>
          </div>
        </form>
      </div>

      <div class="card-body" style="border-bottom: 1px solid var(--border)">
        <div class="btn-row">
          <span class="hint" style="align-self: center; margin: 0">Manutenção:</span>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="cleaning" @click="cleanup('failed')">Limpar falhos</button>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="cleaning" @click="cleanup('missing')">Limpar sem arquivo</button>
          <span v-if="cleanupMessage" class="muted" style="align-self: center; font-size: 13px">{{ cleanupMessage }}</span>
        </div>
      </div>

      <div v-if="executions.length === 0" class="card-body">
        <div class="empty-state">Nenhuma execução ainda.</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Status</th>
              <th>Tamanho</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="execution in executions" :key="execution.id">
              <td>{{ new Date(execution.createdAt).toLocaleString("pt-BR") }}</td>
              <td><StatusBadge :status="execution.status" kind="job" /></td>
              <td class="mono">{{ formatSize(execution.sizeBytes) }}</td>
              <td class="btn-row">
                <a
                  v-if="execution.status === 'success'"
                  class="btn btn-secondary btn-sm"
                  :href="downloadUrl(execution.id)"
                >
                  Baixar
                </a>
                <button v-if="execution.status === 'success'" type="button" class="btn btn-secondary btn-sm" :disabled="restoreRunning" @click="restoreFrom(execution)">
                  {{ confirming === `restore-${execution.id}` ? "Substituir os dados?" : "Restaurar" }}
                </button>
                <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteExecution(execution.id)">
                  Excluir
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">restore</span>
      Restaurar / importar
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Restaurar <strong>substitui</strong> os dados atuais do banco pelos do backup. Use "Restaurar" numa linha da lista acima, ou envie um arquivo de outro lugar
        (<span class="mono">.sql</span> ou <span class="mono">.sql.gz</span> pra PostgreSQL/MySQL/MariaDB, <span class="mono">.archive.gz</span> pro MongoDB, <span class="mono">.rdb</span>/<span class="mono">.rdb.gz</span> pro Redis e KeyDB,
        <span class="mono">.zip</span> de backup do ClickHouse, ou o <span class="mono">.tar.gz</span> de vários bancos). Arquivos enviados pelo painel podem ter até 120 MB.
      </p>
      <p v-if="engineInfo && !engineInfo.supportsBackup" class="hint mb-16">{{ engineInfo.label }} ainda não tem backup/restore pelo painel.</p>
      <div class="btn-row">
        <input ref="uploadInput" type="file" class="form-control" style="max-width: 320px" :disabled="uploading || restoreRunning || !engineInfo?.supportsBackup" aria-label="Arquivo de backup" @change="uploadAndRestore" />
        <span v-if="uploading" class="muted" style="align-self: center">enviando...</span>
      </div>
    </div>
    <div v-if="restores.length" class="table-wrap">
      <table>
        <thead><tr><th>Quando</th><th>Origem</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <template v-for="r in restores" :key="r.id">
            <tr>
              <td>{{ new Date(r.createdAt).toLocaleString("pt-BR") }}</td>
              <td class="mono">{{ r.sourceLabel }}</td>
              <td><StatusBadge :status="r.status" kind="job" /></td>
              <td><button type="button" class="btn btn-secondary btn-sm" @click="openRestoreId = openRestoreId === r.id ? null : r.id">Log</button></td>
            </tr>
            <tr v-if="openRestoreId === r.id"><td colspan="4"><pre class="callout-code" style="max-height: 300px; overflow: auto; margin: 0">{{ r.log || "(sem saída ainda)" }}</pre></td></tr>
          </template>
        </tbody>
      </table>
    </div>
    <div class="card-body" style="border-top: 1px solid var(--border)">
      <p class="hint" style="margin: 0"><strong>Volume persistente não é backup:</strong> se o servidor for perdido, os dados vão junto. Guarde os backups em um destino S3, fora do servidor.</p>
    </div>
  </div>
</template>
