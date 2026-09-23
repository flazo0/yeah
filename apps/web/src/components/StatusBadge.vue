<script setup lang="ts">
import { computed } from "vue";
import { statusTone, type StatusKind } from "../lib/status";

const props = defineProps<{ status: string; dot?: boolean; kind?: StatusKind }>();
const tone = computed(() => statusTone(props.status, props.kind));
</script>

<template>
  <span class="badge" :class="`badge-${tone}`">
    <span v-if="dot" class="status-dot" :class="`status-dot-${tone}`"></span>
    {{ status }}
  </span>
</template>
