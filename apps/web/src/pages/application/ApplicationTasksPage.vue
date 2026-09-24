<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { ScheduledTaskDto, ScheduledTaskExecutionDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import PageState from "../../components/PageState.vue";

const { basePath, error } = useApplicationContext();

const tasks = ref<ScheduledTaskDto[]>([]);
const loading = ref(true);
const busy = ref(false);
const showForm = ref(false);
const editingId = ref<string | null>(null);
const form = ref({ name: "", command: "", cron: "0 * * * *", timezone: "UTC", timeoutSeconds: 300 });
const confirmingDelete = ref<string | null>(null);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const openTaskId = ref<string | null>(null);
const executions = ref<ScheduledTaskExecutionDto[]>([]);
let poll: ReturnType<typeof setInterval> | undefined;

const presets = [
  { label: "A cada minuto", cron: "* * * * *" },
  { label: "A cada hora", cron: "0 * * * *" },
  { label: "Todo dia às 03:00", cron: "0 3 * * *" },
  { label: "Toda segunda às 08:00", cron: "0 8 * * 1" },
];

async function load() {
  try {
    tasks.value = (await api.get<{ tasks: ScheduledTaskDto[] }>(`${basePath}/tasks`)).tasks;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar as tarefas";
  } finally {
    loading.value = false;
  }
}

async function loadExecutions() {
  if (!openTaskId.value) return;
  try {
    executions.value = (await api.get<{ executions: ScheduledTaskExecutionDto[] }>(`${basePath}/tasks/${openTaskId.value}/executions`)).executions;
  } catch {
    /* next poll retries */
  }
}

function startNew() {
  editingId.value = null;
  form.value = { name: "", command: "", cron: "0 * * * *", timezone: "UTC", timeoutSeconds: 300 };
  showForm.value = true;
}

function startEdit(task: ScheduledTaskDto) {
  editingId.value = task.id;
  form.value = { name: task.name, command: task.command, cron: task.cron, timezone: task.timezone, timeoutSeconds: task.timeoutSeconds };
  showForm.value = true;
}

async function save() {
  busy.value = true;
  error.value = "";
  try {
    if (editingId.value) await api.put(`${basePath}/tasks/${editingId.value}`, { ...form.value });
    else await api.post(`${basePath}/tasks`, { ...form.value });
    showForm.value = false;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar a tarefa";
  } finally {
    busy.value = false;
  }
}

async function toggle(task: ScheduledTaskDto) {
  error.value = "";
  try {
    await api.put(`${basePath}/tasks/${task.id}`, {
      name: task.name,
      command: task.command,
      cron: task.cron,
      timezone: task.timezone,
      timeoutSeconds: task.timeoutSeconds,
      enabled: !task.enabled,
    });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao atualizar a tarefa";
  }
}

async function runNow(task: ScheduledTaskDto) {
  error.value = "";
  try {
    await api.post(`${basePath}/tasks/${task.id}/run`);
    await openHistory(task.id, true);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao executar a tarefa";
  }
}

async function remove(task: ScheduledTaskDto) {
  if (confirmingDelete.value !== task.id) {
    confirmingDelete.value = task.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingDelete.value = null), 3000);
    return;
  }
  try {
    await api.delete(`${basePath}/tasks/${task.id}`);
    if (openTaskId.value === task.id) openTaskId.value = null;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover a tarefa";
  } finally {
    confirmingDelete.value = null;
  }
}

async function openHistory(taskId: string, forceOpen = false) {
  if (openTaskId.value === taskId && !forceOpen) {
    openTaskId.value = null;
    return;
  }
  openTaskId.value = taskId;
  executions.value = [];
  await loadExecutions();
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function tone(status: string): string {
  return status === "success" ? "ok" : status === "failed" ? "bad" : "warn";
}

onMounted(() => {
  void load();
  // While a history is open (or a run is in flight) keep it fresh.
  poll = setInterval(() => {
    if (openTaskId.value) {
      void loadExecutions();
      void load();
    }
  }, 3000);
});
onBeforeUnmount(() => {
  clearInterval(poll);
  clearTimeout(confirmTimer);
});
</script>

<template>
  <PageState :loading="loading" :empty="false">
    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">schedule</span>
        Tarefas agendadas
        <button type="button" class="btn btn-sm" style="margin-left: auto" @click="startNew">Nova tarefa</button>
      </div>
      <div class="card-body">
        <p class="hint">
          Roda um comando <em>dentro do container</em> da aplicação num horário (cron) — limpar cache, rodar
          <span class="mono">schedule:run</span>, mandar um relatório. A saída fica guardada (últimas 50 execuções) e uma falha avisa nos canais de notificação.
        </p>
      </div>
    </div>

    <form v-if="showForm" class="card mb-16" @submit.prevent="save">
      <div class="card-header">{{ editingId ? "Editar tarefa" : "Nova tarefa" }}</div>
      <div class="card-body">
        <div class="form-group">
          <label for="task-name">Nome</label>
          <input id="task-name" v-model="form.name" required maxlength="255" placeholder="Limpar cache" />
        </div>
        <div class="form-group">
          <label for="task-command">Comando</label>
          <input id="task-command" v-model="form.command" required class="mono" placeholder="php artisan cache:clear" />
        </div>
        <div class="form-group">
          <label for="task-cron">Frequência (cron)</label>
          <input id="task-cron" v-model="form.cron" required class="mono" placeholder="0 * * * *" />
          <div class="btn-row" style="margin-top: 6px">
            <button v-for="p in presets" :key="p.cron" type="button" class="btn btn-secondary btn-sm" @click="form.cron = p.cron">{{ p.label }}</button>
          </div>
        </div>
        <div class="form-group">
          <label for="task-tz">Fuso horário</label>
          <input id="task-tz" v-model="form.timezone" placeholder="UTC" />
        </div>
        <div class="form-group">
          <label for="task-timeout">Limite de tempo (segundos)</label>
          <input id="task-timeout" v-model.number="form.timeoutSeconds" type="number" min="1" max="86400" />
        </div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="busy">Salvar</button>
          <button type="button" class="btn btn-secondary" @click="showForm = false">Cancelar</button>
        </div>
      </div>
    </form>

    <div v-if="tasks.length === 0 && !showForm" class="card">
      <div class="card-body"><p class="hint">Nenhuma tarefa agendada ainda.</p></div>
    </div>

    <div v-for="task in tasks" :key="task.id" class="card mb-16">
      <div class="card-body">
        <div class="btn-row" style="justify-content: space-between; align-items: flex-start">
          <div style="min-width: 0">
            <strong>{{ task.name }}</strong>
            <span v-if="!task.enabled" class="badge" style="margin-left: 8px">pausada</span>
            <div class="mono hint" style="word-break: break-all">{{ task.command }}</div>
            <div class="hint">
              <span class="mono">{{ task.cron }}</span> ({{ task.timezone }}) · limite {{ task.timeoutSeconds }}s
              <template v-if="task.lastExecution">
                · última: <span :class="['tone-' + tone(task.lastExecution.status)]">{{ task.lastExecution.status }}</span> em {{ fmt(task.lastExecution.startedAt) }}
              </template>
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-secondary btn-sm" @click="runNow(task)">Executar agora</button>
            <button type="button" class="btn btn-secondary btn-sm" @click="openHistory(task.id)">Histórico</button>
            <button type="button" class="btn btn-secondary btn-sm" @click="toggle(task)">{{ task.enabled ? "Pausar" : "Ativar" }}</button>
            <button type="button" class="btn btn-secondary btn-sm" @click="startEdit(task)">Editar</button>
            <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="remove(task)">
              {{ confirmingDelete === task.id ? "Confirmar?" : "Remover" }}
            </button>
          </div>
        </div>

        <div v-if="openTaskId === task.id" style="margin-top: 12px">
          <p v-if="executions.length === 0" class="hint">Sem execuções ainda.</p>
          <details v-for="(e, i) in executions" :key="e.id" :open="i === 0" style="margin-bottom: 6px">
            <summary>
              <span :class="['tone-' + tone(e.status)]">{{ e.status }}</span>
              · {{ fmt(e.startedAt) }}<template v-if="e.manual"> · manual</template><template v-if="e.exitCode !== null"> · código {{ e.exitCode }}</template>
            </summary>
            <pre class="callout-code" style="max-height: 260px; overflow: auto">{{ e.log || "(sem saída)" }}</pre>
          </details>
        </div>
      </div>
    </div>
  </PageState>
</template>
