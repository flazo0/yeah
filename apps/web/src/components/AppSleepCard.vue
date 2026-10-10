<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ sleepAfterMinutes: number | null; hasDomain: boolean; putUrl: string }>();
const emit = defineEmits<{ saved: [number | null]; error: [string] }>();

const enabled = ref(false);
const minutes = ref(10);
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  enabled.value = props.sleepAfterMinutes !== null;
  minutes.value = props.sleepAfterMinutes ?? 10;
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const value = enabled.value ? Math.round(minutes.value) : null;
    await api.put(props.putUrl, { sleepAfterMinutes: value });
    emit("saved", value);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("appSleepCard.falha"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">bedtime</span>
    {{ $t("appSleepCard.titulo") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">{{ $t("appSleepCard.dica") }}</p>
    <p v-if="!hasDomain" class="hint mb-16">{{ $t("appSleepCard.precisaDeDominio") }}</p>
    <div class="form-group">
      <label for="app-sleep-enabled" style="display: flex; gap: 8px; align-items: center">
        <input id="app-sleep-enabled" v-model="enabled" type="checkbox" :disabled="!hasDomain" />
        {{ $t("appSleepCard.ativar") }}
      </label>
    </div>
    <div v-if="enabled" class="form-group">
      <label for="app-sleep-minutes">{{ $t("appSleepCard.minutos") }}</label>
      <input id="app-sleep-minutes" v-model.number="minutes" type="number" min="1" max="10080" class="form-control" />
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving || !hasDomain" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("resourceLimitsCard.salvando") : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("appSleepCard.salvo") }}</span>
    </div>
  </div>
</template>
