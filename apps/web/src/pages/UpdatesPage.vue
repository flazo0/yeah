<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ImageUpdateResourceDto, PlatformOperationDto, PlatformOperationStatus, SystemImageUpdateDto, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import DeployLogTerminal from "../components/DeployLogTerminal.vue";
import StatusBadge from "../components/StatusBadge.vue";
import PageState from "../components/PageState.vue";

const route = useRoute();
const teamId = route.params.teamId as string;

interface PlatformUpdate {
  currentCommit: string | null;
  latestCommit: string | null;
  updateAvailable: boolean | null;
  compareUrl: string | null;
}

const platform = ref<PlatformUpdate | null>(null);
const images = ref<ImageUpdateResourceDto[]>([]);
const systemImages = ref<SystemImageUpdateDto[]>([]);
const loading = ref(true);
const error = ref("");

const platformOp = ref<PlatformOperationDto | null>(null);
const systemOp = ref<PlatformOperationDto | null>(null);
const confirmingPlatform = ref(false);
const confirmingSystem = ref(false);
let confirmPlatformTimer: ReturnType<typeof setTimeout> | undefined;
let confirmSystemTimer: ReturnType<typeof setTimeout> | undefined;

function opRunning(op: PlatformOperationDto | null): boolean {
  return op?.status === "queued" || op?.status === "running";
}

const applyingResource = ref<string | null>(null);
const applyingAll = ref(false);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [platformRes, imagesRes, opsRes] = await Promise.all([
      api.get<PlatformUpdate>("/updates/platform"),
      api.get<{ images: ImageUpdateResourceDto[]; system: SystemImageUpdateDto[] }>(`/teams/${teamId}/updates/images`),
      api.get<{ platformUpdate: PlatformOperationDto | null; systemUpdate: PlatformOperationDto | null }>("/updates/operations"),
    ]);
    platform.value = platformRes;
    images.value = imagesRes.images;
    systemImages.value = imagesRes.system;
    platformOp.value = opsRes.platformUpdate;
    systemOp.value = opsRes.systemUpdate;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao checar atualizações";
  } finally {
    loading.value = false;
  }
}

async function runPlatformUpdate() {
  if (!confirmingPlatform.value) {
    confirmingPlatform.value = true;
    clearTimeout(confirmPlatformTimer);
    confirmPlatformTimer = setTimeout(() => (confirmingPlatform.value = false), 3000);
    return;
  }
  clearTimeout(confirmPlatformTimer);
  confirmingPlatform.value = false;
  error.value = "";
  try {
    const res = await api.post<{ operation: PlatformOperationDto }>("/updates/platform/run", {});
    platformOp.value = res.operation;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar a atualização";
  }
}

async function runSystemUpdate() {
  if (!confirmingSystem.value) {
    confirmingSystem.value = true;
    clearTimeout(confirmSystemTimer);
    confirmSystemTimer = setTimeout(() => (confirmingSystem.value = false), 3000);
    return;
  }
  clearTimeout(confirmSystemTimer);
  confirmingSystem.value = false;
  error.value = "";
  try {
    const res = await api.post<{ operation: PlatformOperationDto }>("/updates/system/run", {});
    systemOp.value = res.operation;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar a atualização";
  }
}

async function applyImageUpdate(item: ImageUpdateResourceDto) {
  applyingResource.value = item.resourceId;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/updates/images/apply`, { resourceType: item.resourceType, resourceId: item.resourceId });
    item.currentTag = item.latestTag ?? item.currentTag;
    item.updateAvailable = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao atualizar";
  } finally {
    applyingResource.value = null;
  }
}

async function applyAllImageUpdates() {
  applyingAll.value = true;
  error.value = "";
  try {
    for (const item of images.value.filter((i) => i.updateAvailable)) {
      await api.post(`/teams/${teamId}/updates/images/apply`, { resourceType: item.resourceType, resourceId: item.resourceId });
      item.currentTag = item.latestTag ?? item.currentTag;
      item.updateAvailable = false;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao atualizar tudo";
  } finally {
    applyingAll.value = false;
  }
}

let unsubscribe: (() => void) | undefined;
onMounted(() => {
  load();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "platform-operation.log") {
      if (platformOp.value?.id === event.operationId) platformOp.value.log += event.line;
      if (systemOp.value?.id === event.operationId) systemOp.value.log += event.line;
    }
    if (event.type === "platform-operation.status") {
      if (platformOp.value?.id === event.operationId) platformOp.value.status = event.status;
      if (systemOp.value?.id === event.operationId) systemOp.value.status = event.status;
    }
  });
});
onUnmounted(() => {
  unsubscribe?.();
  clearTimeout(confirmPlatformTimer);
  clearTimeout(confirmSystemTimer);
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Atualizações</h1>
        <p>Checagem automática — os botões abaixo aplicam de verdade, direto na VPS.</p>
      </div>
      <button type="button" class="btn btn-secondary" :disabled="loading" @click="load">
        <span class="material-symbols-outlined" style="font-size: 18px">refresh</span>
        Checar de novo
      </button>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">deployed_code_update</span>
        Plataforma (yeah)
      </div>
      <div v-if="loading" class="card-body"><PageState loading /></div>
      <div v-else-if="!platform || platform.currentCommit === null" class="card-body">
        <div class="empty-state">
          Sem versão rastreável aqui (rodando fora de um container de produção — normal em desenvolvimento local).
        </div>
      </div>
      <div v-else class="card-body">
        <div class="grid grid-2">
          <div>
            <div class="stat-label">Commit atual</div>
            <div class="mono">{{ platform.currentCommit.slice(0, 12) }}</div>
          </div>
          <div>
            <div class="stat-label">Último no main</div>
            <div class="mono">{{ platform.latestCommit ? platform.latestCommit.slice(0, 12) : "não foi possível checar" }}</div>
          </div>
        </div>
        <div class="btn-row mt-16" style="margin-top: 16px">
          <span v-if="platform.updateAvailable === true" class="badge badge-warn">atualização disponível</span>
          <span v-else-if="platform.updateAvailable === false" class="badge badge-good">em dia</span>
          <a v-if="platform.compareUrl" :href="platform.compareUrl" target="_blank" rel="noopener" class="label-link">ver mudanças</a>
          <button
            type="button"
            class="btn"
            style="margin-left: auto"
            :disabled="opRunning(platformOp)"
            @click="runPlatformUpdate"
          >
            <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
            {{ opRunning(platformOp) ? "atualizando..." : confirmingPlatform ? "Confirmar atualização?" : "Atualizar plataforma" }}
          </button>
        </div>
        <p class="hint mt-16" style="margin-top: 12px">
          Faz <span class="mono">git pull</span> + rebuild dos containers + migrations, direto no servidor marcado como host da plataforma. A API/worker reiniciam durante o processo — o log abaixo continua acompanhando mesmo assim.
        </p>
        <div v-if="platformOp" class="mt-16" style="margin-top: 12px">
          <div class="btn-row mb-16" style="margin-bottom: 8px">
            <StatusBadge :status="platformOp.status" kind="job" />
          </div>
          <DeployLogTerminal :log="platformOp.log" />
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
        Sistema operacional (VPS)
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          Roda <span class="mono">apt-get update && apt-get upgrade</span> no servidor marcado como host da plataforma. Pode deixar
          um kernel novo instalado sem reiniciar — reinicie a VPS manualmente depois se precisar.
        </p>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" :disabled="opRunning(systemOp)" @click="runSystemUpdate">
            <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
            {{ opRunning(systemOp) ? "atualizando..." : confirmingSystem ? "Confirmar atualização?" : "Atualizar sistema" }}
          </button>
          <StatusBadge v-if="systemOp" :status="systemOp.status" kind="job" style="align-self: center" />
        </div>
        <div v-if="systemOp" class="mt-16" style="margin-top: 12px">
          <DeployLogTerminal :log="systemOp.log" />
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">inventory_2</span>
        Imagens Docker em uso
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          style="margin-left: auto"
          :disabled="applyingAll || !images.some((i) => i.updateAvailable)"
          @click="applyAllImageUpdates"
        >
          {{ applyingAll ? "atualizando tudo..." : "Atualizar tudo" }}
        </button>
      </div>
      <div v-if="loading" class="card-body"><PageState loading /></div>
      <div v-else-if="images.length === 0" class="card-body">
        <div class="empty-state">Nenhum banco ou serviço criado ainda pra checar.</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recurso</th>
              <th>Imagem</th>
              <th>Tag atual</th>
              <th>Tag mais recente</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="img in images" :key="`${img.resourceType}-${img.resourceId}`">
              <td>{{ img.resourceName }}</td>
              <td class="mono">{{ img.image.split(":")[0] }}</td>
              <td class="mono">{{ img.currentTag }}</td>
              <td class="mono">{{ img.latestTag ?? "-" }}</td>
              <td>
                <span v-if="img.updateAvailable === true" class="badge badge-warn">nova tag disponível</span>
                <span v-else-if="img.updateAvailable === false" class="badge badge-good">em dia</span>
                <span v-else class="badge badge-neutral">não verificável</span>
              </td>
              <td>
                <button
                  v-if="img.updateAvailable"
                  type="button"
                  class="btn btn-secondary btn-sm"
                  :disabled="applyingResource === img.resourceId || applyingAll"
                  @click="applyImageUpdate(img)"
                >
                  {{ applyingResource === img.resourceId ? "atualizando..." : "Atualizar" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="systemImages.length > 0" class="card-body" style="border-top: 1px solid var(--border)">
        <div class="stat-label mb-16" style="margin-bottom: 8px">Imagens de sistema (proxy etc.)</div>
        <div v-for="img in systemImages" :key="img.image" class="btn-row mb-16" style="justify-content: space-between">
          <span class="mono">{{ img.image.split(":")[0] }}:{{ img.currentTag }}</span>
          <span v-if="img.updateAvailable === true" class="badge badge-warn">{{ img.latestTag }} disponível</span>
          <span v-else-if="img.updateAvailable === false" class="badge badge-good">em dia</span>
          <span v-else class="badge badge-neutral">não verificável</span>
        </div>
        <p class="hint">Atualização automática ainda não suportada pra essas — exige reconfigurar o proxy do servidor.</p>
      </div>
    </div>
  </div>
</template>
