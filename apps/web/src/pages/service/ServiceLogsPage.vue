<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError } from "../../lib/api";
import { useServiceContext } from "../../composables/useServiceContext";
import { i18n } from "../../lib/i18n";

const { basePath } = useServiceContext();
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceLogs.failedReadLogs");
  } finally {
    inFlight = false;
  }
}

onMounted(() => {
  void refresh();
  timer = setInterval(() => {
    if (following.value && document.visibilityState === "visible") void refresh();
  }, 3000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">article</span>
      {{ $t("serviceLogs.stackLogs") }}
      <span class="muted" style="margin-left: auto; font-size: 12px">{{ $t("serviceLogs.allContainersRefreshesEvery3s") }}</span>
    </div>
    <div class="card-body">
      <div class="btn-row mb-16" style="align-items: center">
        <label class="checkbox-row"><input v-model="following" type="checkbox" /> {{ $t("serviceLogs.follow") }}</label>
        <select v-model.number="tail" class="form-control" style="width: auto" :aria-label="$t('serviceLogs.lines')" @change="refresh">
          <option :value="100">{{ $t("serviceLogs.n100Lines") }}</option>
          <option :value="300">{{ $t("serviceLogs.n300Lines") }}</option>
          <option :value="1000">{{ $t("serviceLogs.n1000Lines") }}</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" @click="refresh"><span class="material-symbols-outlined" style="font-size: 16px">refresh</span> {{ $t("serviceLogs.refresh") }}</button>
      </div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <p v-else-if="message" class="hint">{{ message }}</p>
      <pre v-else ref="box" class="callout-code" style="max-height: 480px; overflow: auto; margin: 0">{{ loaded ? logs || $t('common.noOutput') : $t('common.loading') }}</pre>
    </div>
  </div>
</template>
