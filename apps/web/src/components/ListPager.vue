<script setup lang="ts">
import { computed, watch } from "vue";
import { i18n } from "../lib/i18n";

const props = withDefaults(defineProps<{ total: number; sizeKey?: string; sizes?: number[] }>(), { sizes: () => [10, 25, 50] });
const page = defineModel<number>("page", { default: 1 });
const pageSize = defineModel<number>("pageSize", { default: 10 });

if (props.sizeKey) {
  try {
    const stored = Number(localStorage.getItem(props.sizeKey));
    if (props.sizes.includes(stored)) pageSize.value = stored;
  } catch {
    // ignore
  }
}
watch(pageSize, (v) => {
  page.value = 1;
  if (!props.sizeKey) return;
  try {
    localStorage.setItem(props.sizeKey, String(v));
  } catch {
    // ignore
  }
});

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / pageSize.value)));
const label = computed(() => {
  if (props.total === 0) return "0 de 0";
  const start = (page.value - 1) * pageSize.value + 1;
  return i18n.global.t("listPager.p0P1DeP2", { p0: start, p1: Math.min(page.value * pageSize.value, props.total), p2: props.total });
});
</script>

<template>
  <div class="rtable-pager">
    <span class="muted">{{ label }}</span>
    <div class="rtable-pager-controls">
      <select v-model.number="pageSize" class="form-control" :aria-label="$t('listPager.itensPorPagina')">
        <option v-for="size in sizes" :key="size" :value="size">{{ size }}</option>
      </select>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" :aria-label="$t('listPager.paginaAnterior')" @click="page--">
        <span class="material-symbols-outlined" style="font-size: 18px">chevron_left</span>
      </button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= pageCount" :aria-label="$t('listPager.proximaPagina')" @click="page++">
        <span class="material-symbols-outlined" style="font-size: 18px">chevron_right</span>
      </button>
    </div>
  </div>
</template>
