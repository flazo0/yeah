<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BackupExecutionDto,
  BackupExecutionStatus,
  BackupScheduleDto,
  DatabaseDto,
  DatabaseStatus,
  S3StorageDto,
  WsServerEvent,
} from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import Breadcrumb from "../components/Breadcrumb.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const databaseId = route.params.databaseId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}/databases/${databaseId}`;
const environmentPath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

const database = ref<DatabaseDto | null>(null);
const schedule = ref<BackupScheduleDto | null>(null);
const executions = ref<BackupExecutionDto[]>([]);
const loading = ref(true);
const error = ref("");

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
const storages = ref<S3StorageDto[]>([]);

const limitsForm = ref<{ memoryLimitMb: number | null; cpuLimit: number | null }>({ memoryLimitMb: null, cpuLimit: null });
const savingLimits = ref(false);
const limitsSaved = ref(false);

const statusBadge: Record<DatabaseStatus, string> = {
  idle: "badge-neutral",
  provisioning: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};
const executionBadge: Record<BackupExecutionStatus, string> = {
  queued: "badge-neutral",
  running: "badge-warn",
  success: "badge-good",
  failed: "badge-bad",
};

const activeTab = ref<"backups" | "config">("backups");
const confirmingDelete = ref(false);
const deleting = ref(false);
let confirmingDeleteTimer: ReturnType<typeof setTimeout> | undefined;

async function deleteDatabase() {
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
    error.value = err instanceof ApiError ? err.message : "falha ao excluir banco de dados";
    confirmingDelete.value = false;
    deleting.value = false;
  }
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function load() {
  loading.value = true;
  try {
    const [dbRes, scheduleRes, storagesRes] = await Promise.all([
      api.get<{ database: DatabaseDto }>(basePath),
      api.get<{ schedule: BackupScheduleDto | null }>(`${basePath}/backup-schedule`),
      api.get<{ storages: S3StorageDto[] }>(`/teams/${teamId}/storages`),
    ]);
    database.value = dbRes.database;
    limitsForm.value = { memoryLimitMb: dbRes.database.memoryLimitMb, cpuLimit: dbRes.database.cpuLimit };
    schedule.value = scheduleRes.schedule;
    storages.value = storagesRes.storages;
    if (schedule.value) await loadExecutions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar banco de dados";
  } finally {
    loading.value = false;
  }
}

async function loadExecutions() {
  const res = await api.get<{ executions: BackupExecutionDto[] }>(`${basePath}/backup-executions`);
  executions.value = res.executions;
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

async function saveLimits() {
  savingLimits.value = true;
  limitsSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ database: DatabaseDto }>(`${basePath}/limits`, {
      memoryLimitMb: limitsForm.value.memoryLimitMb || null,
      cpuLimit: limitsForm.value.cpuLimit || null,
    });
    database.value = res.database;
    limitsSaved.value = true;
    setTimeout(() => (limitsSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar limites";
  } finally {
    savingLimits.value = false;
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
    if (event.type === "database.status" && event.databaseId === databaseId && database.value) {
      database.value.status = event.status;
    }
    if (event.type === "backup.status" && schedule.value && event.scheduleId === schedule.value.id) {
      loadExecutions();
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
  <div v-else-if="!database" class="empty-state">Banco de dados não encontrado.</div>
  <div v-else>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" :current="database.name" />
    <div class="resource-header">
      <div class="resource-title">
        <span class="material-symbols-outlined">database</span>
        {{ database.name }}
        <span class="badge" :class="statusBadge[database.status]">{{ database.status }}</span>
      </div>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="deleting" @click="deleteDatabase">
        <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
        {{ confirmingDelete ? "Confirmar exclusão?" : "Excluir" }}
      </button>
    </div>
    <p class="resource-subtitle mono">
      {{ database.engine }} ·
      <template v-if="database.username">{{ database.username }}@</template>{{ database.serverName }}:{{ database.port }}
      <template v-if="database.databaseName"> / {{ database.databaseName }}</template>
    </p>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="detail-tabs">
      <button type="button" class="detail-tab" :class="{ active: activeTab === 'backups' }" @click="activeTab = 'backups'">
        <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
        Backups
      </button>
      <button type="button" class="detail-tab" :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">
        <span class="material-symbols-outlined" style="font-size: 18px">tune</span>
        Configuration
      </button>
    </div>

    <div v-if="activeTab === 'config'" class="detail-layout">
      <nav class="detail-subnav">
        <button type="button" class="detail-subnav-item active">Geral</button>
      </nav>
      <div class="card" style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">info</span>
          Geral
        </div>
        <div class="card-body">
          <div class="grid grid-2">
            <div>
              <div class="stat-label">Motor</div>
              <div class="mono">{{ database.engine }}</div>
            </div>
            <div>
              <div class="stat-label">Imagem</div>
              <div class="mono">{{ database.image }}</div>
            </div>
            <div>
              <div class="stat-label">Servidor</div>
              <div>{{ database.serverName }}</div>
            </div>
            <div>
              <div class="stat-label">Porta</div>
              <div class="mono">{{ database.port }}</div>
            </div>
            <div v-if="database.username">
              <div class="stat-label">Usuário</div>
              <div class="mono">{{ database.username }}</div>
            </div>
            <div v-if="database.databaseName">
              <div class="stat-label">Database</div>
              <div class="mono">{{ database.databaseName }}</div>
            </div>
          </div>
        </div>
        <div class="card-header" style="border-top: 1px solid var(--border)">
          <span class="material-symbols-outlined" style="font-size: 18px">speed</span>
          Limites de recurso
        </div>
        <div class="card-body">
          <p class="hint mb-16">Deixe em branco pra não limitar. Recria o container imediatamente ao salvar.</p>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="db-limit-mem">Memória (MB)</label>
              <input id="db-limit-mem" v-model.number="limitsForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="db-limit-cpu">CPU (cores)</label>
              <input id="db-limit-cpu" v-model.number="limitsForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary" :disabled="savingLimits" @click="saveLimits">
              <span class="material-symbols-outlined" style="font-size: 18px">save</span>
              {{ savingLimits ? "salvando..." : "Salvar" }}
            </button>
            <span v-if="limitsSaved" class="muted" style="align-self: center; font-size: 13px">salvo — recriando container</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="card">
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
                <td><span class="badge" :class="executionBadge[execution.status]">{{ execution.status }}</span></td>
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
  </div>
</template>
