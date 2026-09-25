<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { api, ApiError } from "../../lib/api";
import { useServiceContext } from "../../composables/useServiceContext";

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
    error.value = err instanceof ApiError ? err.message : "falha ao ler os logs";
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
      Logs da stack
      <span class="muted" style="margin-left: auto; font-size: 12px">todos os containers, atualiza a cada 3s</span>
    </div>
    <div class="card-body">
      <div class="btn-row mb-16" style="align-items: center">
        <label class="checkbox-row"><input v-model="following" type="checkbox" /> Acompanhar</label>
        <select v-model.number="tail" class="form-control" style="width: auto" aria-label="Linhas" @change="refresh">
          <option :value="100">100 linhas</option>
          <option :value="300">300 linhas</option>
          <option :value="1000">1000 linhas</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" @click="refresh"><span class="material-symbols-outlined" style="font-size: 16px">refresh</span> Atualizar</button>
      </div>
      <div v-if="error" class="alert alert-error">{{ error }}</div>
      <p v-else-if="message" class="hint">{{ message }}</p>
      <pre v-else ref="box" class="callout-code" style="max-height: 480px; overflow: auto; margin: 0">{{ loaded ? logs || "(sem saída)" : "carregando..." }}</pre>
    </div>
  </div>
</template>
