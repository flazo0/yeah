<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { BackupExecutionDto, BackupExecutionStatus, BackupScheduleDto, S3StorageDto, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { wsClient } from "../../lib/ws";
import { useDatabaseContext } from "../../composables/useDatabaseContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { basePath, error } = useDatabaseContext();
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
    });
    schedule.value = res.schedule;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar agendamento";
  } finally {
    creatingSchedule.value = false;
  }
}

async function deleteSchedule() {
  if (!schedule.value) return;
  await api.delete(`${basePath}/backup-schedule/${schedule.value.id}`);
  schedule.value = null;
  executions.value = [];
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
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "backup.status" && schedule.value && event.scheduleId === schedule.value.id) {
      loadExecutions();
    }
  });
});
onUnmounted(() => {
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
          <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteSchedule">
            <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
            Remover agendamento
          </button>
        </div>
        <p class="hint">
          Retenção: {{ schedule.retentionCount || "∞" }} backups · {{ schedule.retentionDays || "∞" }} dias ·
          {{ schedule.retentionSizeGb || "∞" }} GB
        </p>
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
</template>
