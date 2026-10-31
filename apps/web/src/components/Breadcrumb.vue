<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api } from "../lib/api";

const props = defineProps<{
  teamId: string;
  projectId: string;
  environmentId: string;
  /** Trailing segment (e.g. the resource's own name) — rendered as plain text, not a link. */
  current?: string;
}>();

const projectName = ref("");
const environmentName = ref("");

watchEffect(async () => {
  try {
    const res = await api.get<{ project: { name: string }; environment: { name: string } }>(
      `/teams/${props.teamId}/projects/${props.projectId}/environments/${props.environmentId}`,
    );
    projectName.value = res.project.name;
    environmentName.value = res.environment.name;
  } catch {
    // Best-effort — a failed breadcrumb fetch shouldn't block the page it's decorating.
  }
});
</script>

<template>
  <nav class="breadcrumb">
    <RouterLink :to="`/teams/${teamId}/projects/${projectId}`" class="breadcrumb-item">{{ projectName || "…" }}</RouterLink>
    <span class="breadcrumb-sep">›</span>
    <RouterLink :to="`/teams/${teamId}/projects/${projectId}/environments/${environmentId}`" class="breadcrumb-item">
      {{ environmentName || "…" }}
    </RouterLink>
    <template v-if="current">
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">{{ current }}</span>
    </template>
  </nav>
</template>
