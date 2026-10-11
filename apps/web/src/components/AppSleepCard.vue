<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ sleepAfterMinutes: number | null; hasDomain: boolean; putUrl: string }>();
const emit = defineEmits<{ saved: [number | null]; error: [string] }>();

const enabled = ref(false);
const amount = ref(15);
const unit = ref<"min" | "h" | "d">("min");
const FACTOR = { min: 1, h: 60, d: 1440 } as const;
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  enabled.value = props.sleepAfterMinutes !== null;
  const total = props.sleepAfterMinutes ?? 15;
  if (total % 1440 === 0) { unit.value = "d"; amount.value = total / 1440; }
  else if (total % 60 === 0) { unit.value = "h"; amount.value = total / 60; }
  else { unit.value = "min"; amount.value = total; }
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const value = enabled.value ? Math.round(amount.value * FACTOR[unit.value]) : null;
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
    <div v-if="enabled" class="form-row mb-16">
      <div class="form-group" style="margin-bottom: 0">
        <label for="app-sleep-amount">{{ $t("appSleepCard.minutos") }}</label>
        <input id="app-sleep-amount" v-model.number="amount" type="number" min="1" class="form-control" />
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label for="app-sleep-unit">{{ $t("appSleepCard.unidade") }}</label>
        <select id="app-sleep-unit" v-model="unit" class="form-control">
          <option value="min">{{ $t("appSleepCard.min") }}</option>
          <option value="h">{{ $t("appSleepCard.horas") }}</option>
          <option value="d">{{ $t("appSleepCard.dias") }}</option>
        </select>
      </div>
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
