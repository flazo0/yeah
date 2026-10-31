<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ServerCapacityDto, ServerDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ server: ServerDto; teamId: string }>();

const capacity = ref<ServerCapacityDto | null>(null);
const error = ref("");

async function load() {
  error.value = "";
  try {
    const res = await api.get<{ capacity: ServerCapacityDto }>(`/teams/${props.teamId}/servers/${props.server.id}/capacity`);
    capacity.value = res.capacity;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverCapacity.failedToLoad");
  }
}

onMounted(load);
// the total memory arrives with the first metrics check
watch(() => props.server.memTotalMb, load);

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const barPercent = computed(() => (capacity.value?.commitRatio == null ? 0 : Math.min(100, Math.round(capacity.value.commitRatio * 100))));
const ratioText = computed(() => (capacity.value?.commitRatio == null ? "—" : `${Math.round(capacity.value.commitRatio * 100)}%`));
const barColor = computed(() => (capacity.value?.status === "over" ? "var(--danger, #e5484d)" : capacity.value?.status === "tight" ? "var(--warning, #f5a524)" : "var(--accent, #46a758)"));
</script>

<template>
  <div class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">stacked_bar_chart</span>
      {{ $t("serverCapacity.title") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("serverCapacity.hint") }}</p>
      <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
      <div v-if="capacity && capacity.status === 'unknown'" class="empty-state">{{ $t("serverCapacity.waitingForMetrics") }}</div>
      <template v-else-if="capacity">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px">
          <span>{{ $t("serverCapacity.committed", { committed: gb(capacity.committedMb), available: gb(capacity.availableMb) }) }}</span>
          <strong :style="{ color: barColor }">{{ ratioText }}</strong>
        </div>
        <div class="capacity-bar" role="progressbar" :aria-valuenow="barPercent" aria-valuemin="0" aria-valuemax="100" style="height: 8px; border-radius: 4px; background: var(--border); overflow: hidden">
          <div :style="{ width: barPercent + '%', height: '100%', background: barColor }"></div>
        </div>
        <ul class="hint" style="margin: 12px 0 0; padding-left: 18px; line-height: 1.6">
          <li>{{ $t("serverCapacity.serverHas", { total: gb(capacity.memTotalMb ?? 0), available: gb(capacity.availableMb) }) }}</li>
          <li>{{ $t("serverCapacity.resources", { count: capacity.resourceCount, share: gb(capacity.evenShareMb) }) }}</li>
          <li v-if="capacity.unlimitedCount > 0">{{ $t("serverCapacity.unlimited", { count: capacity.unlimitedCount }) }}</li>
        </ul>
        <div v-if="capacity.status === 'over'" class="alert alert-error" style="margin-top: 12px">{{ $t("serverCapacity.over") }}</div>
        <div v-else-if="capacity.status === 'tight'" class="alert alert-warning" style="margin-top: 12px">{{ $t("serverCapacity.tight") }}</div>
      </template>
    </div>
  </div>
</template>
