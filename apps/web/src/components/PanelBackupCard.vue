<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { S3StorageDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { dateLocale, i18n } from "../lib/i18n";

const props = defineProps<{ teamId: string }>();

interface BackupState {
  enabled: boolean;
  storageId: string | null;
  hourUtc: number;
  retention: number;
  lastAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSizeBytes: number | null;
  hasPlatformServer: boolean;
}

const state = ref<BackupState | null>(null);
const storages = ref<S3StorageDto[]>([]);
const enabled = ref(false);
const storageId = ref<string>("");
const hourUtc = ref(3);
const retention = ref(7);
const loading = ref(true);
const saving = ref(false);
const running = ref(false);
const saved = ref(false);
const error = ref("");
let poll: ReturnType<typeof setInterval> | null = null;

const base = computed(() => `/teams/${props.teamId}/instance/backup`);
const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const lastLine = computed(() => {
  const s = state.value;
  if (!s || !s.lastStatus) return "";
  const when = s.lastAt ? new Date(s.lastAt).toLocaleString(dateLocale()) : "";
  if (s.lastStatus === "running") return i18n.global.t("panelBackup.running");
  if (s.lastStatus === "success") return i18n.global.t("panelBackup.lastOk", { when, size: s.lastSizeBytes ? mb(s.lastSizeBytes) : "?" });
  return i18n.global.t("panelBackup.lastFailed", { error: s.lastError ?? "" });
});

function fill(s: BackupState) {
  state.value = s;
  enabled.value = s.enabled;
  storageId.value = s.storageId ?? "";
  hourUtc.value = s.hourUtc;
  retention.value = s.retention;
}

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

async function load() {
  try {
    const [s, st] = await Promise.all([api.get<BackupState>(base.value), api.get<{ storages: S3StorageDto[] }>(`/teams/${props.teamId}/storages`)]);
    fill(s);
    storages.value = st.storages;
  } catch (err) {
    error.value = message(err, i18n.global.t("panelBackup.failedToLoad"));
  } finally {
    loading.value = false;
  }
}

async function refreshState() {
  try {
    fill(await api.get<BackupState>(base.value));
  } catch {
    // keep what is shown
  }
}

onMounted(load);
onBeforeUnmount(() => poll && clearInterval(poll));

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    fill(await api.put<BackupState>(base.value, { enabled: enabled.value, storageId: storageId.value || null, hourUtc: Math.round(hourUtc.value), retention: Math.round(retention.value) }));
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    error.value = message(err, i18n.global.t("panelBackup.failedToSave"));
  } finally {
    saving.value = false;
  }
}

async function runNow() {
  running.value = true;
  error.value = "";
  try {
    await api.post(`${base.value}/run`, {});
    // the job runs in the worker: look at the result for a while
    let tries = 0;
    if (poll) clearInterval(poll);
    poll = setInterval(async () => {
      await refreshState();
      tries++;
      if ((state.value?.lastStatus !== "running" && tries > 1) || tries > 40) {
        if (poll) clearInterval(poll);
        poll = null;
        running.value = false;
      }
    }, 3000);
  } catch (err) {
    error.value = message(err, i18n.global.t("panelBackup.failedToRun"));
    running.value = false;
  }
}
</script>

<template>
  <div class="card mb-16">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">backup</span>
      {{ $t("panelBackup.title") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("panelBackup.hint") }}</p>
      <div class="alert alert-warning mb-16">{{ $t("panelBackup.keyWarning") }}</div>
      <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
      <p v-if="loading" class="muted">{{ $t("common.loading") }}</p>
      <template v-else-if="state">
        <div v-if="!state.hasPlatformServer" class="alert alert-warning mb-16">{{ $t("panelBackup.noServer") }}</div>
        <div v-else-if="storages.length === 0" class="alert alert-warning mb-16">
          {{ $t("panelBackup.noStorage") }}
          <RouterLink :to="`/teams/${teamId}/storages`">{{ $t("panelBackup.openStorages") }}</RouterLink>
        </div>

        <div class="form-group">
          <label for="panel-backup-enabled" style="display: flex; gap: 8px; align-items: center">
            <input id="panel-backup-enabled" v-model="enabled" type="checkbox" :disabled="!state.hasPlatformServer" />
            {{ $t("panelBackup.enable") }}
          </label>
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="panel-backup-storage">{{ $t("panelBackup.storage") }}</label>
            <select id="panel-backup-storage" v-model="storageId" class="form-control">
              <option value="">{{ $t("panelBackup.chooseStorage") }}</option>
              <option v-for="s in storages" :key="s.id" :value="s.id">{{ s.name }} ({{ s.bucket }})</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="panel-backup-hour">{{ $t("panelBackup.hour") }}</label>
            <input id="panel-backup-hour" v-model.number="hourUtc" type="number" min="0" max="23" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="panel-backup-retention">{{ $t("panelBackup.retention") }}</label>
            <input id="panel-backup-retention" v-model.number="retention" type="number" min="1" max="90" class="form-control" />
          </div>
        </div>

        <p v-if="lastLine" class="mb-16" :class="state.lastStatus === 'failed' ? 'text-danger' : 'muted'">{{ lastLine }}</p>

        <div class="btn-row">
          <button type="button" class="btn btn-primary" :disabled="saving || !state.hasPlatformServer" @click="save">
            <span class="material-symbols-outlined" style="font-size: 18px">save</span>
            {{ saving ? $t("resourceLimitsCard.saving") : $t("common.save") }}
          </button>
          <button type="button" class="btn btn-secondary" :disabled="running || !state.storageId || !state.hasPlatformServer" @click="runNow">
            <span class="material-symbols-outlined" style="font-size: 18px">cloud_upload</span>
            {{ running ? $t("panelBackup.running") : $t("panelBackup.runNow") }}
          </button>
          <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("panelBackup.saved") }}</span>
        </div>
        <p class="hint" style="margin-top: 12px">{{ $t("panelBackup.restoreHint") }}</p>
      </template>
    </div>
  </div>
</template>
