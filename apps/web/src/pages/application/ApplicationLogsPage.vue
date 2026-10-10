<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

const { app, basePath } = useApplicationContext();

const logs = ref("");
const message = ref("");
const error = ref("");
const loaded = ref(false);
const following = ref(true);
const tail = ref(300);
const box = ref<HTMLPreElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await api.get<{ logs: string; running: boolean; message?: string }>(`${basePath}/logs?tail=${tail.value}`);
    logs.value = res.logs;
    message.value = res.message ?? "";
    error.value = "";
    loaded.value = true;
    if (following.value) {
      await nextTick();
      if (box.value) box.value.scrollTop = box.value.scrollHeight;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationLogs.falhaAoLerOsLogs");
  } finally {
    inFlight = false;
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(() => {
    if (following.value && document.visibilityState === "visible") refresh();
  }, 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
      {{ $t("applicationLogs.logsDoContainer") }}
      <span class="muted" style="margin-left: auto; font-size: 12px">{{ $t("applicationLogs.atualizaACada3s") }}</span>
    </div>
    <div class="card-body">
      <div class="btn-row mb-16" style="align-items: center">
        <label class="checkbox-row">
          <input v-model="following" type="checkbox" />
          {{ $t("applicationLogs.acompanhar") }}
        </label>
        <select v-model.number="tail" class="form-control" style="width: auto" :aria-label="$t('applicationLogs.linhas')" @change="refresh">
          <option :value="100">{{ $t("applicationLogs.100Linhas") }}</option>
          <option :value="300">{{ $t("applicationLogs.300Linhas") }}</option>
          <option :value="1000">{{ $t("applicationLogs.1000Linhas") }}</option>
          <option :value="2000">{{ $t("applicationLogs.2000Linhas") }}</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" @click="refresh">
          <span class="material-symbols-outlined" style="font-size: 16px">refresh</span>
          {{ $t("applicationLogs.atualizar") }}
        </button>
      </div>
      <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
      <div v-if="loaded && message" class="empty-state">{{ message }}</div>
      <pre v-else ref="box" class="log-view">{{ logs || (loaded ? $t('common.noOutputYet') : $t('common.loading')) }}</pre>
      <p v-if="app?.status === 'stopped'" class="hint" style="margin-top: 8px">{{ $t("applicationLogs.aAplicacaoEstaParadaOs") }}</p>
    </div>
  </div>
</template>
