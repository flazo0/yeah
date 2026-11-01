<script setup lang="ts">
import ContainerFiles from "../../components/ContainerFiles.vue";
import { useDatabaseContext } from "../../composables/useDatabaseContext";

const { database, basePath, error } = useDatabaseContext();
</script>

<template>
  <div v-if="database" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">folder_open</span>
      {{ $t("applicationFiles.title") }}
    </div>
    <div class="card-body">
      <ContainerFiles :base-path="basePath" @error="error = $event" />
    </div>
  </div>
</template>
