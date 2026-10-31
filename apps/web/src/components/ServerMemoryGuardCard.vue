<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ server: ServerDto; teamId: string }>();
const emit = defineEmits<{ saved: [ServerDto] }>();

const enabled = ref(false);
const threshold = ref(92);
const recover = ref(80);
const saving = ref(false);
const saved = ref(false);
const error = ref("");

watchEffect(() => {
  enabled.value = props.server.memoryGuardEnabled;
  threshold.value = props.server.memoryGuardThreshold;
  recover.value = props.server.memoryGuardRecover;
});

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${props.teamId}/servers/${props.server.id}/memory-guard`, {
      enabled: enabled.value,
      threshold: Math.round(threshold.value),
      recover: Math.round(recover.value),
    });
    emit("saved", res.server);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("memoryGuard.failedToSave");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">shield</span>
      {{ $t("memoryGuard.title") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("memoryGuard.hint") }}</p>
      <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
      <div class="form-group">
        <label for="memory-guard-enabled" style="display: flex; gap: 8px; align-items: center">
          <input id="memory-guard-enabled" v-model="enabled" type="checkbox" />
          {{ $t("memoryGuard.enable") }}
        </label>
      </div>
      <div v-if="enabled" class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="memory-guard-threshold">{{ $t("memoryGuard.stopAbove") }}</label>
          <input id="memory-guard-threshold" v-model.number="threshold" type="number" min="70" max="99" class="form-control" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="memory-guard-recover">{{ $t("memoryGuard.startBelow") }}</label>
          <input id="memory-guard-recover" v-model.number="recover" type="number" min="40" max="94" class="form-control" />
        </div>
      </div>
      <p v-if="enabled" class="hint mb-16">{{ $t("memoryGuard.howItWorks") }}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ saving ? $t("resourceLimitsCard.saving") : $t("common.save") }}
        </button>
        <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("memoryGuard.saved") }}</span>
      </div>
    </div>
  </div>
</template>
