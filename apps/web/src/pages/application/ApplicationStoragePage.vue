<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ApplicationVolumeDto, S3StorageDto, VolumeBackupDto, VolumeKind } from "@yeah/shared";
import StatusBadge from "../../components/StatusBadge.vue";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";
import { dateLocale } from "../../lib/i18n";

const { app, basePath, error, reloadApp } = useApplicationContext();

const teamId = useRoute().params.teamId as string;
const storages = ref<S3StorageDto[]>([]);
const storageId = ref("");
const volumes = ref<ApplicationVolumeDto[]>([]);
const kind = ref<VolumeKind>("volume");
const name = ref("");
const mountPath = ref("");
const hostPath = ref("");
const fileContent = ref("");
const adding = ref(false);
const deletingId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editContent = ref("");

const kindLabels: Record<VolumeKind, string> = { volume: i18n.global.t("applicationStorage.kindVolume"), bind: i18n.global.t("applicationStorage.serverDirectory"), file: i18n.global.t("applicationStorage.kindFile") };

async function load() {
  try {
    volumes.value = (await api.get<{ volumes: ApplicationVolumeDto[] }>(`${basePath}/volumes`)).volumes;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedLoadStorage");
  }
}
// ---- backups of the volumes' contents
const backups = ref<VolumeBackupDto[]>([]);
const openLogId = ref<string | null>(null);
const confirmingRestore = ref("");
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
const backupBusy = computed(() => backups.value.some((b) => b.status === "queued" || b.status === "running"));

async function loadBackups() {
  try {
    backups.value = (await api.get<{ backups: VolumeBackupDto[] }>(`${basePath}/volume-backups`)).backups;
  } catch {
    /* next poll */
  }
}

async function backupVolume(volume: ApplicationVolumeDto) {
  error.value = "";
  try {
    await api.post(`${basePath}/volumes/${volume.id}/backup`, { storageId: storageId.value || null });
    await loadBackups();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedStartBackup");
  }
}

async function restoreBackup(b: VolumeBackupDto) {
  if (confirmingRestore.value !== b.id) {
    confirmingRestore.value = b.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingRestore.value = ""), 4000);
    return;
  }
  confirmingRestore.value = "";
  error.value = "";
  try {
    await api.post(`${basePath}/volume-backups/${b.id}/restore`, {});
    await loadBackups();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedStartRestore");
  }
}

async function deleteBackup(b: VolumeBackupDto) {
  try {
    await api.delete(`${basePath}/volume-backups/${b.id}`);
    backups.value = backups.value.filter((x) => x.id !== b.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedToDelete");
  }
}

const downloadUrl = (id: string) => `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}${basePath}/volume-backups/${id}/download`;
const size = (n: number | null) => (!n ? "-" : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

onMounted(() => {
  void load();
  api.get<{ storages: S3StorageDto[] }>(`/teams/${teamId}/storages`).then((r) => (storages.value = r.storages)).catch(() => undefined);
  void loadBackups();
  poll = setInterval(() => {
    if (backupBusy.value) void loadBackups();
  }, 3000);
});
onBeforeUnmount(() => {
  clearInterval(poll);
  clearTimeout(confirmTimer);
});

const canAdd = () =>
  name.value.trim() && mountPath.value.trim() && (kind.value !== "bind" || hostPath.value.trim()) && (kind.value !== "file" || fileContent.value.length > 0);

async function add() {
  if (!canAdd()) return;
  adding.value = true;
  error.value = "";
  try {
    const res = await api.post<{ volume: ApplicationVolumeDto }>(`${basePath}/volumes`, {
      name: name.value.trim(),
      mountPath: mountPath.value.trim(),
      kind: kind.value,
      ...(kind.value === "bind" ? { hostPath: hostPath.value.trim() } : {}),
      ...(kind.value === "file" ? { fileContent: fileContent.value } : {}),
    });
    volumes.value = [...volumes.value, res.volume];
    name.value = mountPath.value = hostPath.value = fileContent.value = "";
    void reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedAddStorage");
  } finally {
    adding.value = false;
  }
}

async function remove(id: string) {
  deletingId.value = id;
  error.value = "";
  try {
    await api.delete(`${basePath}/volumes/${id}`);
    volumes.value = volumes.value.filter((v) => v.id !== id);
    void reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedRemoveStorage");
  } finally {
    deletingId.value = null;
  }
}

function startEdit(v: ApplicationVolumeDto) {
  editingId.value = v.id;
  editContent.value = v.fileContent ?? "";
}

async function saveEdit(v: ApplicationVolumeDto) {
  error.value = "";
  try {
    const res = await api.put<{ volume: ApplicationVolumeDto }>(`${basePath}/volumes/${v.id}`, { fileContent: editContent.value });
    volumes.value = volumes.value.map((x) => (x.id === v.id ? res.volume : x));
    editingId.value = null;
    void reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationStorage.failedSaveFile");
  }
}
</script>

<template>
  <div class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">hard_drive</span>
      {{ $t("applicationStorage.persistentStorage") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("applicationStorage.appliesNextDeploy") }} <strong>{{ $t("applicationStorage.aPersistentVolumeNotBackup") }}</strong> {{ $t("applicationStorage.itSurvivesRedeploysButIf") }}
      </p>
      <p v-if="app?.buildPack === 'docker_compose'" class="hint mb-16">{{ $t("applicationStorage.inDockerComposeApplicationsWhat") }}</p>
      <div v-if="volumes.length === 0" class="empty-state">{{ $t("applicationStorage.nothingConfigured") }}</div>
      <div v-else class="table-wrap mb-16">
        <table>
          <thead>
            <tr><th>{{ $t("applicationStorage.type") }}</th><th>{{ $t("applicationStorage.name") }}</th><th>{{ $t("applicationStorage.inTheContainer") }}</th><th>{{ $t("applicationStorage.source") }}</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="v in volumes" :key="v.id">
              <tr>
                <td>{{ kindLabels[v.kind] }}</td>
                <td>{{ v.name }}</td>
                <td class="mono">{{ v.mountPath }}</td>
                <td class="mono">{{ v.kind === "bind" ? v.hostPath : v.kind === "file" ? $t("applicationStorage.charactersCount", { n: (v.fileContent ?? "").length }) : $t("applicationStorage.managedByDocker") }}</td>
                <td>
                  <div class="btn-row">
                    <button v-if="app?.buildPack !== 'docker_compose'" type="button" class="btn btn-secondary btn-sm" :disabled="backupBusy" @click="backupVolume(v)">{{ $t("applicationStorage.backup") }}</button>
                    <button v-if="v.kind === 'file'" type="button" class="btn btn-secondary btn-sm" @click="startEdit(v)">{{ $t("applicationStorage.edit") }}</button>
                    <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" :disabled="deletingId === v.id" @click="remove(v.id)">
                      {{ deletingId === v.id ? $t("applicationStorage.removing") : $t('common.remove') }}
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="editingId === v.id">
                <td colspan="5">
                  <textarea v-model="editContent" class="form-control mono" rows="8" :aria-label="$t('applicationStorage.contentsOf', { p0: v.mountPath })"></textarea>
                  <div class="btn-row" style="margin-top: 8px">
                    <button type="button" class="btn btn-secondary btn-sm" @click="saveEdit(v)">{{ $t("applicationStorage.saveFile") }}</button>
                    <button type="button" class="btn btn-secondary btn-sm" @click="editingId = null">{{ $t("applicationStorage.cancel") }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="form-group">
        <label for="vol-kind">{{ $t("applicationStorage.type") }}</label>
        <select id="vol-kind" v-model="kind" class="form-control" style="max-width: 280px">
          <option value="volume">{{ $t("applicationStorage.dockerVolumePersistentData") }}</option>
          <option value="bind">{{ $t("applicationStorage.serverDirectory") }}</option>
          <option value="file">{{ $t("applicationStorage.fileContentStoredPanel") }}</option>
        </select>
        <p class="hint" style="margin-top: 6px">
          <template v-if="kind === 'volume'">{{ $t("applicationStorage.dockerManagesVolumeNameJust") }}</template>
          <template v-if="kind === 'bind'">{{ $t("applicationStorage.mountsFolderAlreadyExistsWill") }}</template>
          <template v-if="kind === 'file'">{{ $t("applicationStorage.theContentEncryptedPanelWritten") }} <span class="mono">{{ $t("applicationStorage.htpasswd") }}</span>.</template>
        </p>
      </div>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="vol-name">{{ $t("applicationStorage.name") }}</label>
          <input id="vol-name" v-model="name" class="form-control" :placeholder="$t('applicationStorage.uploads')" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="vol-path">{{ $t("applicationStorage.pathContainer") }}</label>
          <input id="vol-path" v-model="mountPath" class="form-control mono" placeholder="/app/uploads" />
        </div>
      </div>
      <div v-if="kind === 'bind'" class="form-group">
        <label for="vol-host">{{ $t("applicationStorage.directoryServer") }}</label>
        <input id="vol-host" v-model="hostPath" class="form-control mono" placeholder="/srv/data" />
      </div>
      <div v-if="kind === 'file'" class="form-group">
        <label for="vol-content">{{ $t("applicationStorage.fileContent") }}</label>
        <textarea id="vol-content" v-model="fileContent" class="form-control mono" rows="6"></textarea>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="adding || !canAdd()" @click="add">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ adding ? $t("applicationStorage.adding") : $t("common.add") }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="app && app.buildPack !== 'docker_compose' && (backups.length > 0 || volumes.length > 0)" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
      {{ $t("applicationStorage.storageBackups") }}
    </div>
    <div class="card-body">
      <p class="hint" style="margin: 0">
        {{ $t("applicationStorage.backupLineAboveCreates") }} <span class="mono">{{ $t("applicationStorage.tarGz") }}</span> {{ $t("applicationStorage.ofVolumeSContentServer") }}
        <strong>{{ $t("applicationStorage.replaces") }}</strong> {{ $t("applicationStorage.theVolumeSCurrentContent") }}
      </p>
    </div>
    <div v-if="storages.length" class="card-body" style="display: flex; align-items: center; gap: 8px">
      <label for="backup-destination" class="hint" style="margin: 0">{{ $t("applicationStorage.storeIn") }}</label>
      <select id="backup-destination" v-model="storageId" class="input" style="max-width: 320px">
        <option value="">{{ $t("applicationStorage.onThisServer") }}</option>
        <option v-for="st in storages" :key="st.id" :value="st.id">{{ $t("applicationStorage.s3P0P1", { p0: st.name, p1: st.bucket }) }}</option>
      </select>
    </div>
    <div v-if="backups.length" class="table-wrap">
      <table>
        <thead><tr><th>{{ $t("applicationStorage.when") }}</th><th>{{ $t("applicationStorage.volume") }}</th><th>{{ $t("applicationStorage.operation") }}</th><th>{{ $t("applicationStorage.status") }}</th><th>{{ $t("applicationStorage.size") }}</th><th></th></tr></thead>
        <tbody>
          <template v-for="b in backups" :key="b.id">
            <tr>
              <td>{{ new Date(b.createdAt).toLocaleString(dateLocale()) }}</td>
              <td class="mono">{{ b.label }}</td>
              <td>{{ b.operation === "backup" ? "backup" : "restore" }}</td>
              <td><StatusBadge :status="b.status" kind="job" /></td>
              <td class="mono">{{ size(b.sizeBytes) }}<span v-if="b.inS3" class="hint"> {{ $t("applicationStorage.s3") }}</span></td>
              <td>
                <div class="btn-row">
                  <template v-if="b.operation === 'backup' && b.status === 'success'">
                    <a class="btn btn-secondary btn-sm" :href="downloadUrl(b.id)">{{ $t("applicationStorage.download") }}</a>
                    <button type="button" class="btn btn-secondary btn-sm" :disabled="backupBusy" @click="restoreBackup(b)">{{ confirmingRestore === b.id ? $t("applicationStorage.replaceTheData") : $t("common.restore") }}</button>
                  </template>
                  <button type="button" class="btn btn-secondary btn-sm" @click="openLogId = openLogId === b.id ? null : b.id">{{ $t("applicationStorage.log") }}</button>
                  <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteBackup(b)">{{ $t("applicationStorage.delete") }}</button>
                </div>
              </td>
            </tr>
            <tr v-if="openLogId === b.id"><td colspan="6"><pre class="callout-code" style="max-height: 240px; overflow: auto; margin: 0">{{ b.log || $t('common.noOutputYet') }}</pre></td></tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
