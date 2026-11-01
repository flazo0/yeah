<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  maintenanceContainers: string[];
  /** Compose services of the stack; empty for a single-container service (no per-container choice). */
  stackServices: string[];
  putUrl: string;
}>();
const emit = defineEmits<{ saved: [{ maintenanceMode: boolean; maintenanceMessage: string | null; maintenanceContainers: string[] }]; error: [string] }>();

const enabled = ref(false);
const message = ref("");
const containers = ref<string[]>([]);
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  enabled.value = props.maintenanceMode;
  message.value = props.maintenanceMessage ?? "";
  containers.value = [...props.maintenanceContainers];
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const res = await api.put<{ service: { maintenanceMode: boolean; maintenanceMessage: string | null; maintenanceContainers: string[] } }>(props.putUrl, { enabled: enabled.value, message: message.value, containers: containers.value });
    emit("saved", { maintenanceMode: res.service.maintenanceMode, maintenanceMessage: res.service.maintenanceMessage, maintenanceContainers: res.service.maintenanceContainers });
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("serviceMaintenance.failedToSave"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">construction</span>
    {{ $t("serviceMaintenance.title") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">{{ $t("serviceMaintenance.hint") }}</p>

    <div class="form-group">
      <label for="svc-maint-enabled" style="display: flex; gap: 8px; align-items: center">
        <input id="svc-maint-enabled" v-model="enabled" type="checkbox" />
        {{ $t("serviceMaintenance.enable") }}
      </label>
    </div>
    <template v-if="enabled">
      <div class="form-group">
        <label for="svc-maint-message">{{ $t("serviceMaintenance.messageForVisitors") }}</label>
        <input id="svc-maint-message" v-model="message" class="form-control" maxlength="500" :placeholder="$t('serviceMaintenance.placeholder')" />
      </div>
      <div v-if="stackServices.length" class="form-group mb-16">
        <label>{{ $t("serviceMaintenance.containers") }}</label>
        <p class="hint" style="margin: 0 0 6px">{{ $t("serviceMaintenance.containersHint") }}</p>
        <label v-for="s in stackServices" :key="s" style="display: flex; gap: 8px; align-items: center">
          <input v-model="containers" type="checkbox" :value="s" />
          <span class="mono">{{ s }}</span>
        </label>
      </div>
    </template>

    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("resourceLimitsCard.saving") : $t("common.save") }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("serviceMaintenance.savedApplied") }}</span>
    </div>
  </div>
</template>
