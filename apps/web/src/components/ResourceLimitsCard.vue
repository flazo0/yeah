<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";

const props = defineProps<{
  memoryLimitMb: number | null;
  cpuLimit: number | null;
  putUrl: string;
  hint: string;
  savedMessage: string;
}>();

const emit = defineEmits<{
  saved: [{ memoryLimitMb: number | null; cpuLimit: number | null }];
  error: [string];
}>();

const form = ref<{ memoryLimitMb: number | null; cpuLimit: number | null }>({ memoryLimitMb: null, cpuLimit: null });
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  form.value = { memoryLimitMb: props.memoryLimitMb, cpuLimit: props.cpuLimit };
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const memoryLimitMb = form.value.memoryLimitMb || null;
    const cpuLimit = form.value.cpuLimit || null;
    await api.put(props.putUrl, { memoryLimitMb, cpuLimit });
    emit("saved", { memoryLimitMb, cpuLimit });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : "falha ao salvar limites");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">speed</span>
    Limites de recurso
  </div>
  <div class="card-body">
    <p class="hint mb-16">Deixe em branco pra não limitar. {{ hint }}</p>
    <div class="form-row mb-16">
      <div class="form-group" style="margin-bottom: 0">
        <label for="resource-limit-mem">Memória (MB)</label>
        <input id="resource-limit-mem" v-model.number="form.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label for="resource-limit-cpu">CPU (cores)</label>
        <input id="resource-limit-cpu" v-model.number="form.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? "salvando..." : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ savedMessage }}</span>
    </div>
  </div>
</template>
