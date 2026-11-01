<script setup lang="ts">
import ContainerFiles from "../../components/ContainerFiles.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error } = useApplicationContext();
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">folder_open</span>
      {{ $t("applicationFiles.title") }}
    </div>
    <div class="card-body">
      <ContainerFiles :base-path="basePath" @error="error = $event" />
    </div>
  </div>
</template>
