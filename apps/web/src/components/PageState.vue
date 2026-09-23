<script setup lang="ts">
defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyIcon?: string;
  emptyText?: string;
}>();
</script>

<template>
  <div v-if="loading" class="empty-state page-state"><span class="spinner"></span> carregando...</div>
  <div v-else-if="error" class="alert alert-error">{{ error }}</div>
  <div v-else-if="empty" class="empty-state page-state">
    <span class="material-symbols-outlined icon">{{ emptyIcon ?? "inbox" }}</span>
    <slot name="empty">{{ emptyText ?? "Nada por aqui ainda." }}</slot>
  </div>
  <slot v-else />
</template>
