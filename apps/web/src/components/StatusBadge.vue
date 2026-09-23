<script setup lang="ts">
import { computed } from "vue";
import { statusTone } from "../lib/status";

const props = defineProps<{ status: string; dot?: boolean }>();
const tone = computed(() => statusTone(props.status));
</script>

<template>
  <span class="badge" :class="`badge-${tone}`">
    <span v-if="dot" class="status-dot" :class="`status-dot-${tone}`"></span>
    {{ status }}
  </span>
</template>
