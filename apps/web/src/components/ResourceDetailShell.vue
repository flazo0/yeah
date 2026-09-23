<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import Breadcrumb from "./Breadcrumb.vue";
import StatusBadge from "./StatusBadge.vue";

export interface ShellTab {
  to: string;
  label: string;
  icon: string;
  active: boolean;
}
export interface ShellSubnavItem {
  to: string;
  label: string;
  active: boolean;
}

defineProps<{
  teamId: string;
  projectId: string;
  environmentId: string;
  name: string;
  icon: string;
  status: string;
  error?: string;
  deleting?: boolean;
  tabs?: ShellTab[];
  /** When set, the page body is laid out as a left sub-navigation next to the routed content. */
  subnav?: ShellSubnavItem[] | null;
}>();
const emit = defineEmits<{ delete: [] }>();

// First click arms the delete, a second one within 3s confirms it.
const confirming = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
function onDelete() {
  if (!confirming.value) {
    confirming.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (confirming.value = false), 3000);
    return;
  }
  clearTimeout(timer);
  confirming.value = false;
  emit("delete");
}
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" :current="name" />
    <div class="resource-header">
      <div class="resource-title">
        <span class="material-symbols-outlined">{{ icon }}</span>
        {{ name }}
        <StatusBadge :status="status" />
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="deleting" @click="onDelete">
          <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
          {{ confirming ? "Confirmar exclusão?" : "Excluir" }}
        </button>
        <slot name="actions" />
      </div>
    </div>
    <slot name="subtitle" />

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="tabs && tabs.length > 0" class="detail-tabs">
      <RouterLink v-for="tab in tabs" :key="tab.to" :to="tab.to" class="detail-tab" :class="{ active: tab.active }">
        <span class="material-symbols-outlined" style="font-size: 18px">{{ tab.icon }}</span>
        {{ tab.label }}
      </RouterLink>
    </div>

    <div v-if="subnav" class="detail-layout">
      <nav class="detail-subnav">
        <RouterLink v-for="item in subnav" :key="item.to" :to="item.to" class="detail-subnav-item" :class="{ active: item.active }">
          {{ item.label }}
        </RouterLink>
      </nav>
      <slot />
    </div>
    <slot v-else />
  </div>
</template>
