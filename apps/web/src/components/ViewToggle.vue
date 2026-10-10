<script setup lang="ts">
import { watch } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const props = defineProps<{ storageKey: string }>();
const view = defineModel<"list" | "grid">({ default: "list" });

try {
  if (localStorage.getItem(props.storageKey) === "grid") view.value = "grid";
} catch {
  // storage blocked — default view applies
}
watch(view, (v) => {
  try {
    localStorage.setItem(props.storageKey, v);
  } catch {
    // preference just won't persist
  }
});
</script>

<template>
  <div class="view-toggle" role="group" :aria-label="t('common.viewMode')">
    <button type="button" :class="{ active: view === 'list' }" :title="t('common.list')" :aria-label="t('common.list')" @click="view = 'list'">
      <span class="material-symbols-outlined">view_list</span>
    </button>
    <button type="button" :class="{ active: view === 'grid' }" :title="t('common.grid')" :aria-label="t('common.grid')" @click="view = 'grid'">
      <span class="material-symbols-outlined">grid_view</span>
    </button>
  </div>
</template>
