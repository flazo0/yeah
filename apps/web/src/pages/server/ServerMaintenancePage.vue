<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { DockerCleanupExecutionDto, DockerCleanupScheduleDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { server, teamId, error } = useServerContext();
const basePath = () => `/teams/${teamId}/servers/${server.value!.id}/docker-cleanup`;

const schedule = ref<DockerCleanupScheduleDto | null>(null);
const executions = ref<DockerCleanupExecutionDto[]>([]);
const loaded = ref(false);
const saving = ref(false);
const runningNow = ref(false);
const openLogId = ref<string | null>(null);
const form = ref({ cron: "0 4 * * 0", timezone: "UTC", enabled: false, pruneImages: false, pruneVolumes: false });
let poll: ReturnType<typeof setInterval> | undefined;

const busy = () => executions.value.some((e) => e.status === "queued" || e.status === "running");

async function load() {
  try {
    const res = await api.get<{ schedule: DockerCleanupScheduleDto | null; executions: DockerCleanupExecutionDto[] }>(basePath());
    schedule.value = res.schedule;
    executions.value = res.executions;
    if (res.schedule) form.value = { cron: res.schedule.cron, timezone: res.schedule.timezone, enabled: res.schedule.enabled, pruneImages: res.schedule.pruneImages, pruneVolumes: res.schedule.pruneVolumes };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar a limpeza agendada";
  } finally {
    loaded.value = true;
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  try {
    const res = await api.put<{ schedule: DockerCleanupScheduleDto }>(basePath(), form.value);
    schedule.value = res.schedule;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar";
  } finally {
    saving.value = false;
  }
}

async function runNow() {
  runningNow.value = true;
  error.value = "";
  try {
    await api.post(`${basePath()}/run`, {});
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar a limpeza";
  } finally {
    runningNow.value = false;
  }
}

const size = (n: number | null) => (n === null ? "-" : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

onMounted(() => {
  void load();
  poll = setInterval(() => {
    if (busy()) void load();
  }, 4000);
});
onBeforeUnmount(() => clearInterval(poll));
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">cleaning_services</span>
      Limpeza do Docker
      <StatusBadge v-if="schedule" :status="schedule.enabled ? 'active' : 'inactive'" style="margin-left: auto" />
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Roda <span class="mono">docker system prune</span> neste servidor: sempre remove containers parados, redes sem uso e cache de build.
        <strong>Também remover imagens sem uso</strong> só libera espaço (nenhuma imagem em uso por um container some).
        <strong>Também remover volumes sem uso</strong> pode apagar dados de verdade — só um volume que nenhum container referencia hoje é removido, mas isso inclui volumes nomeados de recursos que você só parou, não excluiu. Deixe desligado a menos que saiba o que está fazendo.
      </p>
      <form @submit.prevent="save">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="dc-cron">Frequência (cron)</label>
            <input id="dc-cron" v-model="form.cron" class="form-control mono" placeholder="0 4 * * 0" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="dc-tz">Timezone</label>
            <input id="dc-tz" v-model="form.timezone" class="form-control" placeholder="UTC" />
          </div>
        </div>
        <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
          <input id="dc-enabled" v-model="form.enabled" type="checkbox" />
          <label for="dc-enabled" style="margin: 0">Agendamento ativo</label>
        </div>
        <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
          <input id="dc-images" v-model="form.pruneImages" type="checkbox" />
          <label for="dc-images" style="margin: 0">Também remover imagens sem uso (<span class="mono">-a</span>)</label>
        </div>
        <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
          <input id="dc-volumes" v-model="form.pruneVolumes" type="checkbox" />
          <label for="dc-volumes" style="margin: 0">Também remover volumes sem uso (<span class="mono">--volumes</span>) — pode apagar dados</label>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="saving">
            <span class="material-symbols-outlined" style="font-size: 18px">save</span>
            {{ saving ? "salvando..." : "Salvar" }}
          </button>
          <button type="button" class="btn btn-secondary" :disabled="runningNow || busy()" @click="runNow">
            <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
            {{ runningNow || busy() ? "rodando..." : "Rodar agora" }}
          </button>
        </div>
      </form>
    </div>
  </div>

  <div v-if="loaded && executions.length" class="card" style="margin-top: 16px">
    <div class="card-header">Histórico</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Quando</th><th>Tipo</th><th>Status</th><th>Espaço liberado</th><th></th></tr></thead>
        <tbody>
          <template v-for="e in executions" :key="e.id">
            <tr>
              <td>{{ new Date(e.createdAt).toLocaleString("pt-BR") }}</td>
              <td>{{ e.manual ? "manual" : "agendada" }}</td>
              <td><StatusBadge :status="e.status" kind="job" /></td>
              <td class="mono">{{ size(e.reclaimedBytes) }}</td>
              <td><button type="button" class="btn btn-secondary btn-sm" @click="openLogId = openLogId === e.id ? null : e.id">Log</button></td>
            </tr>
            <tr v-if="openLogId === e.id"><td colspan="5"><pre class="callout-code" style="max-height: 240px; overflow: auto; margin: 0">{{ e.log || "(sem saída ainda)" }}</pre></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
