<script setup lang="ts">
import { useI18n } from "vue-i18n";
const { t } = useI18n();
defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyIcon?: string;
  emptyText?: string;
}>();
</script>

<template>
  <div v-if="loading" class="empty-state page-state"><span class="spinner"></span> {{ t("common.loading") }}</div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else-if="empty" class="empty-state page-state">
    <span class="material-symbols-outlined icon">{{ emptyIcon ?? "inbox" }}</span>
    <slot name="empty">{{ emptyText ?? $t("pageState.nadaPorAquiAinda") }}</slot>
  </div>
  <slot v-else />
</template>
