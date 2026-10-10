<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ServiceContainerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import DomainCard from "../../components/DomainCard.vue";
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import MetricsHistoryChart from "../../components/MetricsHistoryChart.vue";
import { useServiceContext } from "../../composables/useServiceContext";
import { i18n } from "../../lib/i18n";

const { service, basePath, error, reloadService } = useServiceContext();
const isStack = computed(() => Boolean(service.value?.composeContent));

function fetchHistory(hours: number) {
  return api.get<{ history: { at: string; cpu: number; mem: number }[]; multiContainer?: boolean }>(`${basePath}/metrics-history?hours=${hours}`);
}

const containers = ref<ServiceContainerDto[]>([]);
const showLog = ref(false);
const lifecycleBusy = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;

async function loadContainers() {
  if (!isStack.value) return;
  try {
    containers.value = (await api.get<{ containers: ServiceContainerDto[] }>(`${basePath}/containers`)).containers;
  } catch {
    /* next poll */
  }
}
onMounted(() => {
  void loadContainers();
  poll = setInterval(() => void loadContainers(), 5000);
});
onBeforeUnmount(() => clearInterval(poll));

async function lifecycle(action: "start" | "stop" | "restart") {
  lifecycleBusy.value = true;
  error.value = "";
  try {
    await api.post(`${basePath}/lifecycle`, { action });
    setTimeout(() => void Promise.all([reloadService(), loadContainers()]).catch(() => undefined), 5000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceGeneral.falhaAoExecutarAAcao");
  } finally {
    lifecycleBusy.value = false;
  }
}
</script>

<template>
  <div v-if="service" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      {{ $t("serviceGeneral.geral") }}
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">{{ $t("serviceGeneral.catalogo") }}</div>
          <div class="mono">{{ service.catalogKey }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("serviceGeneral.imagem") }}</div>
          <div class="mono">{{ service.image }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("serviceGeneral.servidor") }}</div>
          <div>{{ service.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("serviceGeneral.porta") }}</div>
          <div class="mono">{{ service.port }}</div>
        </div>
      </div>
    </div>

    <div v-if="isStack" class="card-body" style="border-top: 1px solid var(--border)">
      <div class="btn-row" style="justify-content: space-between; margin-bottom: 8px">
        <strong>{{ $t("serviceGeneral.containers") }}</strong>
        <div class="btn-row">
          <button v-if="service.status === 'stopped'" type="button" class="btn btn-secondary btn-sm" :disabled="lifecycleBusy" @click="lifecycle('start')">{{ $t("serviceGeneral.iniciar") }}</button>
          <template v-else-if="service.status === 'running'">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="lifecycleBusy" @click="lifecycle('restart')">{{ $t("serviceGeneral.reiniciar") }}</button>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="lifecycleBusy" @click="lifecycle('stop')">{{ $t("serviceGeneral.parar") }}</button>
          </template>
        </div>
      </div>
      <p v-if="containers.length === 0" class="hint">{{ $t("serviceGeneral.nenhumContainerAindaReimplantarSobe") }}</p>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>{{ $t("serviceGeneral.servico") }}</th><th>{{ $t("serviceGeneral.imagem") }}</th><th>{{ $t("serviceGeneral.estado") }}</th></tr></thead>
          <tbody>
            <tr v-for="c in containers" :key="c.name">
              <td class="mono">{{ c.service }}<span v-if="service.mainService === c.service" class="badge" style="margin-left: 6px">{{ $t("serviceGeneral.principal") }}</span></td>
              <td class="mono">{{ c.image }}</td>
              <td>{{ c.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin-top: 8px">
        {{ $t("serviceGeneral.nomeNaRedeDoAmbiente") }} <span class="mono">{{ service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }}</span>
        {{ $t("serviceGeneral.oPrincipalE") }} <span class="mono">{{ $t("serviceGeneral.container") }}</span> {{ $t("serviceGeneral.praCadaUm") }}
      </p>
      <div v-if="service.lastLog">
        <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="showLog = !showLog">
          {{ $t("serviceGeneral.p0OLogDaUltima", { p0: showLog ? $t('common.hide') : "Ver" }) }}
        </button>
        <pre v-if="showLog" class="callout-code" style="max-height: 300px; overflow: auto; margin-top: 8px">{{ service.lastLog }}</pre>
      </div>
    </div>

    <DomainCard v-if="!isStack"
      :domain="service.domain"
      :put-url="`${basePath}/domain`"
      :saved-message="$t('serviceGeneral.salvoReimplantePraAplicar')"
      @saved="(domain) => (service!.domain = domain)"
      @error="(msg) => (error = msg)"
    />

    <ResourceLimitsCard
      :memory-limit-mb="service.memoryLimitMb"
      :cpu-limit="service.cpuLimit"
      :put-url="`${basePath}/limits`"
      :hint="$t('serviceGeneral.reimplantePraAplicar')"
      :saved-message="$t('serviceGeneral.salvoReimplantePraAplicar')"
      @saved="(limits) => { service!.memoryLimitMb = limits.memoryLimitMb; service!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />

    <div class="card">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">history</span> {{ $t("serviceGeneral.historicoDeRecursos") }}</div>
      <div class="card-body"><MetricsHistoryChart :fetch-history="fetchHistory" /></div>
    </div>
  </div>
</template>
