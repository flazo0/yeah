<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { DockerCleanupExecutionDto, DockerCleanupScheduleDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";
import { i18n } from "../../lib/i18n";
import { dateLocale } from "../../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverMaintenance.falhaAoCarregarALimpeza");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverMaintenance.falhaAoSalvar");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverMaintenance.falhaAoIniciarALimpeza");
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
      {{ $t("serverMaintenance.limpezaDoDocker") }}
      <StatusBadge v-if="schedule" :status="schedule.enabled ? 'active' : 'inactive'" style="margin-left: auto" />
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverMaintenance.roda") }} <span class="mono">{{ $t("serverMaintenance.dockerSystemPrune") }}</span> {{ $t("serverMaintenance.nesteServidorSempreRemoveContainers") }}
        <strong>{{ $t("serverMaintenance.tambemRemoverImagensSemUso") }}</strong> {{ $t("serverMaintenance.soLiberaEspacoNenhumaImagem") }}
        <strong>{{ $t("serverMaintenance.tambemRemoverVolumesSemUso") }}</strong> {{ $t("serverMaintenance.podeApagarDadosDeVerdade") }}
      </p>
      <form @submit.prevent="save">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="dc-cron">{{ $t("serverMaintenance.frequenciaCron") }}</label>
            <input id="dc-cron" v-model="form.cron" class="form-control mono" placeholder="0 4 * * 0" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="dc-tz">{{ $t("serverMaintenance.timezone") }}</label>
            <input id="dc-tz" v-model="form.timezone" class="form-control" :placeholder="$t('serverMaintenance.utc')" />
          </div>
        </div>
        <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
          <input id="dc-enabled" v-model="form.enabled" type="checkbox" />
          <label for="dc-enabled" style="margin: 0">{{ $t("serverMaintenance.agendamentoAtivo") }}</label>
        </div>
        <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
          <input id="dc-images" v-model="form.pruneImages" type="checkbox" />
          <label for="dc-images" style="margin: 0">{{ $t("serverMaintenance.tambemRemoverImagensSemUso2") }}<span class="mono">{{ $t("serverMaintenance.a") }}</span>)</label>
        </div>
        <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
          <input id="dc-volumes" v-model="form.pruneVolumes" type="checkbox" />
          <label for="dc-volumes" style="margin: 0">{{ $t("serverMaintenance.tambemRemoverVolumesSemUso2") }}<span class="mono">{{ $t("serverMaintenance.volumes") }}</span>{{ $t("serverMaintenance.podeApagarDados") }}</label>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="saving">
            <span class="material-symbols-outlined" style="font-size: 18px">save</span>
            {{ saving ? $t("serverMaintenance.salvando") : "Salvar" }}
          </button>
          <button type="button" class="btn btn-secondary" :disabled="runningNow || busy()" @click="runNow">
            <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
            {{ runningNow || busy() ? $t("serverMaintenance.rodando") : $t("serverMaintenance.rodarAgora") }}
          </button>
        </div>
      </form>
    </div>
  </div>

  <div v-if="loaded && executions.length" class="card" style="margin-top: 16px">
    <div class="card-header">{{ $t("serverMaintenance.historico") }}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>{{ $t("serverMaintenance.quando") }}</th><th>{{ $t("serverMaintenance.tipo") }}</th><th>{{ $t("serverMaintenance.status") }}</th><th>{{ $t("serverMaintenance.espacoLiberado") }}</th><th></th></tr></thead>
        <tbody>
          <template v-for="e in executions" :key="e.id">
            <tr>
              <td>{{ new Date(e.createdAt).toLocaleString(dateLocale()) }}</td>
              <td>{{ e.manual ? $t('common.manual') : $t('common.scheduled') }}</td>
              <td><StatusBadge :status="e.status" kind="job" /></td>
              <td class="mono">{{ size(e.reclaimedBytes) }}</td>
              <td><button type="button" class="btn btn-secondary btn-sm" @click="openLogId = openLogId === e.id ? null : e.id">{{ $t("serverMaintenance.log") }}</button></td>
            </tr>
            <tr v-if="openLogId === e.id"><td colspan="5"><pre class="callout-code" style="max-height: 240px; overflow: auto; margin: 0">{{ e.log || $t('common.noOutputYet') }}</pre></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
