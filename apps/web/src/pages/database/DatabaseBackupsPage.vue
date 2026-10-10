<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { DATABASE_ENGINES, type BackupExecutionDto, type BackupScheduleDto, type DatabaseRestoreDto, type S3StorageDto, type WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { wsClient } from "../../lib/ws";
import { useDatabaseContext } from "../../composables/useDatabaseContext";
import StatusBadge from "../../components/StatusBadge.vue";
import { i18n } from "../../lib/i18n";
import { dateLocale } from "../../lib/i18n";

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
const syncKeepCount = ref<number | null>(null);
const savingSync = ref(false);
const syncing = ref(false);
const syncMessage = ref("");
let autoSyncRan = false;
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
    syncKeepCount.value = schedule.value?.autoSyncKeepCount ?? null;
    if (schedule.value) await loadExecutions();
    // "Abrir o painel já sincroniza" — only when the schedule opted in, and only once per visit to this page.
    if (schedule.value?.autoSyncKeepCount && !autoSyncRan) {
      autoSyncRan = true;
      void syncNow();
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaAoCarregarBackups");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaAoCriarAgendamento");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaAoRemover");
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
    cleanupMessage.value = res.removed === 0 ? i18n.global.t("databaseBackups.nadaPraLimpar") : `${res.removed} removido(s).`;
    await loadExecutions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaNaLimpeza");
  } finally {
    cleaning.value = false;
  }
}

async function saveSync() {
  if (!schedule.value) return;
  savingSync.value = true;
  error.value = "";
  try {
    const res = await api.put<{ schedule: BackupScheduleDto }>(`${basePath}/backup-schedule/${schedule.value.id}`, {
      autoSyncKeepCount: syncKeepCount.value && syncKeepCount.value > 0 ? syncKeepCount.value : null,
    });
    schedule.value = res.schedule;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaAoSalvar");
  } finally {
    savingSync.value = false;
  }
}

/**
 * Downloads every not-yet-synced successful execution to the browser's download folder, marks each
 * as synced only after the download itself resolved, then prunes the server/S3 down to the configured
 * keep count — but only among executions already marked synced, so a download that silently failed
 * never costs the only copy of a backup. Stops (without pruning anything) at the first failure.
 */
async function syncNow() {
  if (!schedule.value) return;
  syncing.value = true;
  syncMessage.value = "";
  error.value = "";
  try {
    const pending = executions.value.filter((e) => e.status === "success" && !e.syncedAt);
    let downloaded = 0;
    for (const execution of pending) {
      const res = await fetch(downloadUrl(execution.id), { credentials: "include" });
      if (!res.ok) throw new Error(i18n.global.t("databaseBackups.falhaAoBaixarOBackup", { p0: new Date(execution.createdAt).toLocaleString(dateLocale()) }));
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `backup-${execution.id}`;
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(objectUrl);
      await api.post(`${basePath}/backup-executions/${execution.id}/mark-synced`, {});
      downloaded++;
    }
    if (schedule.value.autoSyncKeepCount) {
      const pruneRes = await api.post<{ removed: number }>(`${basePath}/backup-schedule/${schedule.value.id}/prune`, {});
      syncMessage.value = `${downloaded} baixado(s), ${pruneRes.removed} removido(s) do servidor.`;
    } else {
      syncMessage.value = downloaded === 0 ? i18n.global.t("databaseBackups.nadaNovoPraBaixar") : `${downloaded} baixado(s).`;
    }
    await loadExecutions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : err instanceof Error ? err.message : i18n.global.t("databaseBackups.falhaAoSincronizar");
  } finally {
    syncing.value = false;
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaAoIniciarORestore");
  }
}

async function uploadAndRestore(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!armed(`upload-${file.name}`)) {
    // First selection only arms: the file input is reset so choosing it again confirms.
    error.value = i18n.global.t("databaseBackups.istoVaiSubstituirOsDados", { p0: file.name });
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
    error.value = err instanceof Error ? err.message : i18n.global.t("databaseBackups.falhaAoEnviarOArquivo");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseBackups.falhaAoSalvarAgendamento");
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
      {{ $t("databaseBackups.backups") }}
    </div>

    <div v-if="!schedule" class="card-body">
      <p class="hint mb-16">{{ $t("databaseBackups.semAgendamentoAindaCrieUm") }}</p>
      <form @submit.prevent="createSchedule">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="cron">{{ $t("databaseBackups.frequenciaCron") }}</label>
            <input id="cron" v-model="scheduleForm.cron" class="form-control mono" placeholder="0 0 * * *" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="tz">{{ $t("databaseBackups.timezone") }}</label>
            <input id="tz" v-model="scheduleForm.timezone" class="form-control" :placeholder="$t('databaseBackups.utc')" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="timeout">{{ $t("databaseBackups.timeoutS") }}</label>
            <input id="timeout" v-model.number="scheduleForm.timeoutSeconds" type="number" class="form-control" />
          </div>
        </div>
        <p class="hint mb-16">{{ $t("databaseBackups.retencao0SignificaSemLimite") }}</p>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="retention-count">{{ $t("databaseBackups.nDeBackupsAManter") }}</label>
            <input id="retention-count" v-model.number="scheduleForm.retentionCount" type="number" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="retention-days">{{ $t("databaseBackups.diasAManter") }}</label>
            <input id="retention-days" v-model.number="scheduleForm.retentionDays" type="number" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="retention-size">{{ $t("databaseBackups.armazenamentoMaxGb") }}</label>
            <input id="retention-size" v-model.number="scheduleForm.retentionSizeGb" type="number" class="form-control" />
          </div>
        </div>
        <div v-if="multiDatabase" class="form-group">
          <label for="inc">{{ $t("databaseBackups.bancosAIncluir") }}</label>
          <input id="inc" v-model="scheduleForm.databases" class="form-control mono" :placeholder="$t('databaseBackups.emBrancoSoOBanco')" />
          <p class="hint" style="margin-top: 6px">{{ $t("databaseBackups.nomesSeparadosPorVirgulaCom") }} <span class="mono">{{ $t("databaseBackups.tarGz") }}</span> {{ $t("databaseBackups.comUmDumpPorBanco") }}</p>
        </div>
        <div class="form-group">
          <label for="storage">{{ $t("databaseBackups.destino") }}</label>
          <select id="storage" v-model="scheduleForm.storageId" class="form-control">
            <option value="">{{ $t("databaseBackups.discoDoServidor") }}</option>
            <option v-for="s in storages" :key="s.id" :value="s.id">{{ s.name }} ({{ s.bucket }})</option>
          </select>
        </div>
        <button type="submit" class="btn" :disabled="creatingSchedule">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ creatingSchedule ? $t("databaseBackups.criando") : $t("databaseBackups.criarAgendamento") }}
        </button>
      </form>
    </div>

    <template v-else>
      <div v-if="!editingSchedule" class="card-body" style="border-bottom: 1px solid var(--border)">
        <div class="btn-row mb-16">
          <span class="mono" style="align-self: center">{{ schedule.cron }} ({{ schedule.timezone }})</span>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="runningNow" @click="runNow">
            <span class="material-symbols-outlined" style="font-size: 16px">bolt</span>
            {{ runningNow ? $t("databaseBackups.disparando") : $t("databaseBackups.backupAgora") }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="startEditSchedule">
            <span class="material-symbols-outlined" style="font-size: 16px">edit</span>
            {{ $t("databaseBackups.editar") }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteSchedule(false)">
            <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
            {{ confirming === "schedule" ? $t('common.confirmQ') : $t("databaseBackups.removerAgendamento") }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteSchedule(true)">
            <span class="material-symbols-outlined" style="font-size: 16px">delete_forever</span>
            {{ confirming === "schedule+files" ? $t("databaseBackups.apagarTudoMesmo") : $t("databaseBackups.removerEApagarOsBackups") }}
          </button>
        </div>
        <p class="hint">
          {{ $t("databaseBackups.retencaoP0BackupsP1Dias", { p0: schedule.retentionCount || "∞", p1: schedule.retentionDays || "∞", p2: schedule.retentionSizeGb || "∞" }) }}
        </p>
        <p v-if="schedule.databases" class="hint">{{ $t("databaseBackups.bancos") }} <span class="mono">{{ schedule.databases }}</span></p>
        <p class="hint">
          {{ $t("databaseBackups.destinoP0", { p0: schedule.storageId ? storages.find((s) => s.id === schedule?.storageId)?.name ?? "S3" : $t("databaseBackups.discoDoServidorLower") }) }}
        </p>
      </div>

      <div v-else class="card-body" style="border-bottom: 1px solid var(--border)">
        <form @submit.prevent="saveSchedule">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-cron">{{ $t("databaseBackups.frequenciaCron") }}</label>
              <input id="edit-cron" v-model="editForm.cron" class="form-control mono" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-tz">{{ $t("databaseBackups.timezone") }}</label>
              <input id="edit-tz" v-model="editForm.timezone" class="form-control" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-timeout">{{ $t("databaseBackups.timeoutS") }}</label>
              <input id="edit-timeout" v-model.number="editForm.timeoutSeconds" type="number" class="form-control" />
            </div>
          </div>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-retention-count">{{ $t("databaseBackups.nDeBackupsAManter") }}</label>
              <input id="edit-retention-count" v-model.number="editForm.retentionCount" type="number" class="form-control" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-retention-days">{{ $t("databaseBackups.diasAManter") }}</label>
              <input id="edit-retention-days" v-model.number="editForm.retentionDays" type="number" class="form-control" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="edit-retention-size">{{ $t("databaseBackups.armazenamentoMaxGb") }}</label>
              <input id="edit-retention-size" v-model.number="editForm.retentionSizeGb" type="number" class="form-control" />
            </div>
          </div>
          <div v-if="multiDatabase" class="form-group">
            <label for="edit-inc">{{ $t("databaseBackups.bancosAIncluir") }}</label>
            <input id="edit-inc" v-model="editForm.databases" class="form-control mono" :placeholder="$t('databaseBackups.emBrancoSoOBanco')" />
            <p class="hint" style="margin-top: 6px">{{ $t("databaseBackups.nomesSeparadosPorVirgulaCom") }} <span class="mono">{{ $t("databaseBackups.tarGz") }}</span> {{ $t("databaseBackups.comUmDumpPorBanco") }}</p>
          </div>
            <div class="form-group">
            <label for="edit-storage">{{ $t("databaseBackups.destino") }}</label>
            <select id="edit-storage" v-model="editForm.storageId" class="form-control">
              <option value="">{{ $t("databaseBackups.discoDoServidor") }}</option>
              <option v-for="s in storages" :key="s.id" :value="s.id">{{ s.name }} ({{ s.bucket }})</option>
            </select>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="savingSchedule">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingSchedule ? $t("databaseBackups.salvando") : "Salvar" }}
            </button>
            <button type="button" class="btn btn-secondary" @click="editingSchedule = false">{{ $t("databaseBackups.cancelar") }}</button>
          </div>
        </form>
      </div>

      <div class="card-body" style="border-bottom: 1px solid var(--border)">
        <div class="btn-row">
          <span class="hint" style="align-self: center; margin: 0">{{ $t("databaseBackups.manutencao") }}</span>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="cleaning" @click="cleanup('failed')">{{ $t("databaseBackups.limparFalhos") }}</button>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="cleaning" @click="cleanup('missing')">{{ $t("databaseBackups.limparSemArquivo") }}</button>
          <span v-if="cleanupMessage" class="muted" style="align-self: center; font-size: 13px">{{ cleanupMessage }}</span>
        </div>
      </div>

      <div class="card-body" style="border-bottom: 1px solid var(--border)">
        <p class="hint mb-16">
          {{ $t("databaseBackups.sincronizacaoLocalBaixaProSeu") }}
        </p>
        <div class="btn-row">
          <div class="form-group" style="margin-bottom: 0">
            <label for="sync-keep">{{ $t("databaseBackups.manterNoServidorVazioNao") }}</label>
            <input id="sync-keep" v-model.number="syncKeepCount" type="number" min="1" class="form-control" style="max-width: 160px" @change="saveSync" :disabled="savingSync" />
          </div>
          <button type="button" class="btn btn-secondary btn-sm" style="align-self: flex-end" :disabled="syncing" @click="syncNow">
            <span class="material-symbols-outlined" style="font-size: 16px">sync</span>
            {{ syncing ? $t("databaseBackups.sincronizando") : $t("databaseBackups.sincronizarAgora") }}
          </button>
          <span v-if="syncMessage" class="muted" style="align-self: center; font-size: 13px">{{ syncMessage }}</span>
        </div>
      </div>

      <div v-if="executions.length === 0" class="card-body">
        <div class="empty-state">{{ $t("databaseBackups.nenhumaExecucaoAinda") }}</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ $t("databaseBackups.quando") }}</th>
              <th>{{ $t("databaseBackups.status") }}</th>
              <th>{{ $t("databaseBackups.tamanho") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="execution in executions" :key="execution.id">
              <td>{{ new Date(execution.createdAt).toLocaleString(dateLocale()) }}</td>
              <td><StatusBadge :status="execution.status" kind="job" /></td>
              <td class="mono">{{ formatSize(execution.sizeBytes) }}</td>
              <td class="btn-row">
                <span v-if="execution.syncedAt" class="badge badge-neutral" :title="$t('databaseBackups.jaBaixadoPelaSincronizacaoLocal')">{{ $t("databaseBackups.sincronizado") }}</span>
                <a
                  v-if="execution.status === 'success'"
                  class="btn btn-secondary btn-sm"
                  :href="downloadUrl(execution.id)"
                >
                  {{ $t("databaseBackups.baixar") }}
                </a>
                <button v-if="execution.status === 'success'" type="button" class="btn btn-secondary btn-sm" :disabled="restoreRunning" @click="restoreFrom(execution)">
                  {{ confirming === `restore-${execution.id}` ? $t("databaseBackups.substituirOsDados") : "Restaurar" }}
                </button>
                <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteExecution(execution.id)">
                  {{ $t("databaseBackups.excluir") }}
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
      {{ $t("databaseBackups.restaurarImportar") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("databaseBackups.restaurar") }} <strong>{{ $t("databaseBackups.substitui") }}</strong> {{ $t("databaseBackups.osDadosAtuaisDoBanco") }}<span class="mono">{{ $t("databaseBackups.sql") }}</span> {{ $t("databaseBackups.ou") }} <span class="mono">{{ $t("databaseBackups.sqlGz") }}</span> {{ $t("databaseBackups.praPostgresqlMysqlMariadb") }} <span class="mono">{{ $t("databaseBackups.archiveGz") }}</span> {{ $t("databaseBackups.proMongodb") }} <span class="mono">{{ $t("databaseBackups.rdb") }}</span>/<span class="mono">{{ $t("databaseBackups.rdbGz") }}</span> {{ $t("databaseBackups.proRedisEKeydb") }}
        <span class="mono">{{ $t("databaseBackups.zip") }}</span> {{ $t("databaseBackups.deBackupDoClickhouseOu") }} <span class="mono">{{ $t("databaseBackups.tarGz") }}</span> {{ $t("databaseBackups.deVariosBancosArquivosEnviados") }}
      </p>
      <p v-if="engineInfo && !engineInfo.supportsBackup" class="hint mb-16">{{ $t("databaseBackups.p0AindaNaoTemBackup", { p0: engineInfo.label }) }}</p>
      <div class="btn-row">
        <input ref="uploadInput" type="file" class="form-control" style="max-width: 320px" :disabled="uploading || restoreRunning || !engineInfo?.supportsBackup" :aria-label="$t('databaseBackups.arquivoDeBackup')" @change="uploadAndRestore" />
        <span v-if="uploading" class="muted" style="align-self: center">{{ $t("databaseBackups.enviando") }}</span>
      </div>
    </div>
    <div v-if="restores.length" class="table-wrap">
      <table>
        <thead><tr><th>{{ $t("databaseBackups.quando") }}</th><th>{{ $t("databaseBackups.origem") }}</th><th>{{ $t("databaseBackups.status") }}</th><th></th></tr></thead>
        <tbody>
          <template v-for="r in restores" :key="r.id">
            <tr>
              <td>{{ new Date(r.createdAt).toLocaleString(dateLocale()) }}</td>
              <td class="mono">{{ r.sourceLabel }}</td>
              <td><StatusBadge :status="r.status" kind="job" /></td>
              <td><button type="button" class="btn btn-secondary btn-sm" @click="openRestoreId = openRestoreId === r.id ? null : r.id">{{ $t("databaseBackups.log") }}</button></td>
            </tr>
            <tr v-if="openRestoreId === r.id"><td colspan="4"><pre class="callout-code" style="max-height: 300px; overflow: auto; margin: 0">{{ r.log || $t('common.noOutputYet') }}</pre></td></tr>
          </template>
        </tbody>
      </table>
    </div>
    <div class="card-body" style="border-top: 1px solid var(--border)">
      <p class="hint" style="margin: 0"><strong>{{ $t("databaseBackups.volumePersistenteNaoEBackup") }}</strong> {{ $t("databaseBackups.seOServidorForPerdido") }}</p>
    </div>
  </div>
</template>
