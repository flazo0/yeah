<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ServiceContainerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import DomainCard from "../../components/DomainCard.vue";
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import { useServiceContext } from "../../composables/useServiceContext";

const { service, basePath, error, reloadService } = useServiceContext();
const isStack = computed(() => Boolean(service.value?.composeContent));

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
    error.value = err instanceof ApiError ? err.message : "falha ao executar a ação";
  } finally {
    lifecycleBusy.value = false;
  }
}
</script>

<template>
  <div v-if="service" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Catálogo</div>
          <div class="mono">{{ service.catalogKey }}</div>
        </div>
        <div>
          <div class="stat-label">Imagem</div>
          <div class="mono">{{ service.image }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ service.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ service.port }}</div>
        </div>
      </div>
    </div>

    <div v-if="isStack" class="card-body" style="border-top: 1px solid var(--border)">
      <div class="btn-row" style="justify-content: space-between; margin-bottom: 8px">
        <strong>Containers</strong>
        <div class="btn-row">
          <button v-if="service.status === 'stopped'" type="button" class="btn btn-secondary btn-sm" :disabled="lifecycleBusy" @click="lifecycle('start')">Iniciar</button>
          <template v-else-if="service.status === 'running'">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="lifecycleBusy" @click="lifecycle('restart')">Reiniciar</button>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="lifecycleBusy" @click="lifecycle('stop')">Parar</button>
          </template>
        </div>
      </div>
      <p v-if="containers.length === 0" class="hint">Nenhum container ainda — Reimplantar sobe a stack.</p>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Serviço</th><th>Imagem</th><th>Estado</th></tr></thead>
          <tbody>
            <tr v-for="c in containers" :key="c.name">
              <td class="mono">{{ c.service }}<span v-if="service.mainService === c.service" class="badge" style="margin-left: 6px">principal</span></td>
              <td class="mono">{{ c.image }}</td>
              <td>{{ c.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint" style="margin-top: 8px">
        Nome na rede do ambiente: <span class="mono">{{ service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }}</span>
        (o principal) e <span class="mono">…-container</span> pra cada um.
      </p>
      <div v-if="service.lastLog">
        <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="showLog = !showLog">
          {{ showLog ? "Ocultar" : "Ver" }} o log da última implantação
        </button>
        <pre v-if="showLog" class="callout-code" style="max-height: 300px; overflow: auto; margin-top: 8px">{{ service.lastLog }}</pre>
      </div>
    </div>

    <DomainCard v-if="!isStack"
      :domain="service.domain"
      :put-url="`${basePath}/domain`"
      saved-message="salvo — reimplante pra aplicar"
      @saved="(domain) => (service!.domain = domain)"
      @error="(msg) => (error = msg)"
    />

    <ResourceLimitsCard
      :memory-limit-mb="service.memoryLimitMb"
      :cpu-limit="service.cpuLimit"
      :put-url="`${basePath}/limits`"
      hint="Reimplante pra aplicar."
      saved-message="salvo — reimplante pra aplicar"
      @saved="(limits) => { service!.memoryLimitMb = limits.memoryLimitMb; service!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />
  </div>
</template>
