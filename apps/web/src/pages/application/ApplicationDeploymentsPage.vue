<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { DeploymentDto, DeploymentStatus, RollbackImageEntry, WsServerEvent } from "@yeah/shared";
import { api, ApiError, postConfirmingOverload } from "../../lib/api";
import { wsClient } from "../../lib/ws";
import DeployLogTerminal from "../../components/DeployLogTerminal.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";
import StatusBadge from "../../components/StatusBadge.vue";
import { i18n } from "../../lib/i18n";
import { dateLocale } from "../../lib/i18n";

const { app, basePath, error, lastDeployment } = useApplicationContext();

const history = ref<DeploymentDto[]>([]);
const currentDeploymentId = ref<string | null>(null);
const currentLog = ref("");
const currentStatus = ref<DeploymentStatus | null>(null);
const rollingBackId = ref<string | null>(null);
const images = ref<RollbackImageEntry[]>([]);
const imagesEnabled = ref(false);
const imagesSupported = ref(true);
const imagesLoaded = ref(false);
const imagesError = ref("");

const canDeploy = () => currentStatus.value !== "queued" && currentStatus.value !== "running";

async function load() {
  try {
    const res = await api.get<{ deployments: DeploymentDto[] }>(`${basePath}/deployments`);
    history.value = res.deployments;
    const latest = res.deployments[0];
    if (latest) {
      currentDeploymentId.value = latest.id;
      currentLog.value = latest.log;
      currentStatus.value = latest.status;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationDeployments.failedLoadDeploys");
  }
}

async function loadImages() {
  imagesError.value = "";
  try {
    const res = await api.get<{ enabled: boolean; supported: boolean; images: RollbackImageEntry[] }>(`${basePath}/rollback-images`);
    images.value = res.images;
    imagesEnabled.value = res.enabled;
    imagesSupported.value = res.supported;
  } catch (err) {
    imagesError.value = err instanceof ApiError ? err.message : i18n.global.t("applicationDeployments.failedLoadImages");
  } finally {
    imagesLoaded.value = true;
  }
}

function selectDeployment(deployment: DeploymentDto) {
  currentDeploymentId.value = deployment.id;
  currentLog.value = deployment.log;
  currentStatus.value = deployment.status;
}

async function rollback(deployment: DeploymentDto, fromImage = false) {
  rollingBackId.value = deployment.id;
  error.value = "";
  try {
    const res = await postConfirmingOverload<{ deployment: DeploymentDto }>(`${basePath}/deployments/${deployment.id}/rollback`, fromImage ? { image: true } : {});
    currentDeploymentId.value = res.deployment.id;
    currentLog.value = "";
    currentStatus.value = res.deployment.status;
    history.value = [res.deployment, ...history.value];
    if (app.value) app.value.status = "deploying";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationDeployments.failedRollBackVersion");
  } finally {
    rollingBackId.value = null;
  }
}

// Deploy is triggered from the header (visible on every sub-page) — when we're already on this
// page, there's no remount to re-fetch from, so pick up the new deployment reactively instead.
watch(lastDeployment, (deployment) => {
  if (!deployment) return;
  currentDeploymentId.value = deployment.id;
  currentLog.value = "";
  currentStatus.value = deployment.status;
  history.value = [deployment, ...history.value];
});

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  void loadImages();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "deployment.log" && event.deploymentId === currentDeploymentId.value) {
      currentLog.value += event.line;
    }
    if (event.type === "deployment.status" && event.deploymentId === currentDeploymentId.value) {
      currentStatus.value = event.status;
      const historyEntry = history.value.find((d) => d.id === event.deploymentId);
      if (historyEntry) historyEntry.status = event.status;
      if (event.status === "success") void loadImages();
      if (app.value) {
        if (event.status === "success") app.value.status = "running";
        if (event.status === "failed") app.value.status = "error";
      }
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <div class="card mb-16">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
      {{ $t("applicationDeployments.deployLog") }}
      <StatusBadge v-if="currentStatus" :status="currentStatus" kind="job" style="margin-left: auto" />
    </div>
    <DeployLogTerminal :log="currentLog" />
  </div>

  <div class="card mb-16">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">deployed_code</span>
      {{ $t("applicationDeployments.imagesTitle") }}
    </div>
    <div class="card-body">
      <p class="hint">{{ $t("applicationDeployments.imagesIntro") }}</p>
      <div v-if="imagesError" class="alert alert-error">{{ imagesError }}</div>
      <div v-else-if="!imagesLoaded" class="empty-state">…</div>
      <div v-else-if="!imagesSupported" class="empty-state">{{ $t("applicationDeployments.imagesUnsupported") }}</div>
      <div v-else-if="!imagesEnabled && images.length === 0" class="empty-state">{{ $t("applicationDeployments.imagesOff") }}</div>
      <div v-else-if="images.length === 0" class="empty-state">{{ $t("applicationDeployments.imagesNone") }}</div>
    </div>
    <div v-if="images.length > 0" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t("applicationDeployments.imageTag") }}</th>
            <th>{{ $t("applicationDeployments.imageDeployment") }}</th>
            <th>{{ $t("applicationDeployments.imageSize") }}</th>
            <th>{{ $t("applicationDeployments.imageCreated") }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="image in images" :key="image.ref">
            <td class="mono">{{ image.tag }}</td>
            <td>
              <template v-if="image.deploymentId">
                {{ image.deploymentCreatedAt ? new Date(image.deploymentCreatedAt).toLocaleString(dateLocale()) : "" }}
                <span class="mono">{{ image.commitSha ? image.commitSha.slice(0, 7) : "" }}</span>
              </template>
              <template v-else>{{ $t("applicationDeployments.imageOrphan") }}</template>
              <span v-if="image.running" class="badge badge-success" style="margin-left: 6px">{{ $t("applicationDeployments.imageRunning") }}</span>
            </td>
            <td>{{ image.size }}</td>
            <td>{{ image.created }}</td>
            <td class="btn-row" style="justify-content: flex-end">
              <button
                v-if="image.deploymentId && !image.running"
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="!canDeploy() || rollingBackId === image.deploymentId"
                @click="rollback({ id: image.deploymentId } as DeploymentDto, true)"
              >
                {{ rollingBackId === image.deploymentId ? $t("applicationDeployments.rollingBack") : $t("applicationDeployments.rollBackToImage") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">history</span>
      {{ $t("applicationDeployments.deployHistory") }}
    </div>
    <div v-if="history.length === 0" class="card-body">
      <div class="empty-state">{{ $t("applicationDeployments.noDeploysYet") }}</div>
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t("applicationDeployments.when") }}</th>
            <th>{{ $t("applicationDeployments.commit") }}</th>
            <th>{{ $t("applicationDeployments.status") }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="deployment in history" :key="deployment.id">
            <td>{{ new Date(deployment.createdAt).toLocaleString(dateLocale()) }}</td>
            <td class="mono">{{ deployment.commitSha ? deployment.commitSha.slice(0, 7) : "—" }}</td>
            <td><StatusBadge :status="deployment.status" kind="job" /></td>
            <td class="btn-row" style="justify-content: flex-end">
              <button type="button" class="btn btn-secondary btn-sm" @click="selectDeployment(deployment)">
                {{ $t("applicationDeployments.viewLog") }}
              </button>
              <button
                v-if="deployment.status === 'success'"
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="!canDeploy() || rollingBackId === deployment.id"
                @click="rollback(deployment)"
              >
                {{ rollingBackId === deployment.id ? $t("applicationDeployments.rollingBack") : $t("applicationDeployments.rollBackVersion") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
