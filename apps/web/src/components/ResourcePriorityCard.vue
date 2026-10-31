<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

type Priority = "critical" | "normal" | "low";

const props = defineProps<{ priority: Priority; shedByGuard: boolean; putUrl: string }>();
const emit = defineEmits<{ saved: [Priority]; error: [string] }>();

const value = ref<Priority>("normal");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  value.value = props.priority;
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    await api.put(props.putUrl, { priority: value.value });
    emit("saved", value.value);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("resourcePriority.failedToSave"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">priority_high</span>
    {{ $t("resourcePriority.title") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">{{ $t("resourcePriority.hint") }}</p>
    <div v-if="shedByGuard" class="alert alert-warning mb-16">{{ $t("resourcePriority.stoppedByGuard") }}</div>
    <div class="form-group">
      <label for="resource-priority">{{ $t("resourcePriority.label") }}</label>
      <select id="resource-priority" v-model="value" class="form-control">
        <option value="critical">{{ $t("resourcePriority.critical") }}</option>
        <option value="normal">{{ $t("resourcePriority.normal") }}</option>
        <option value="low">{{ $t("resourcePriority.low") }}</option>
      </select>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving || value === priority" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("resourceLimitsCard.saving") : $t("common.save") }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("resourcePriority.saved") }}</span>
    </div>
  </div>
</template>
