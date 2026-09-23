<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();

function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
}
onMounted(() => document.addEventListener("keydown", onKey));
onUnmounted(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="title">
        <div class="modal-header">
          <h2>{{ title }}</h2>
          <button type="button" class="modal-close" aria-label="Fechar" @click="emit('close')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="modal-body"><slot /></div>
      </div>
    </div>
  </Teleport>
</template>
