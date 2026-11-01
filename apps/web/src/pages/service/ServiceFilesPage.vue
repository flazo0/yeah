<script setup lang="ts">
import { onMounted, ref } from "vue";
import ContainerFiles from "../../components/ContainerFiles.vue";
import { api, ApiError } from "../../lib/api";
import { i18n } from "../../lib/i18n";
import { useServiceContext } from "../../composables/useServiceContext";

const { service, basePath, error } = useServiceContext();

const containers = ref<string[]>([]);
const container = ref("");
const loaded = ref(false);

onMounted(async () => {
  try {
    const res = await api.get<{ containers: string[] }>(`${basePath}/files/containers`);
    containers.value = res.containers;
    container.value = res.containers[0] ?? "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationFiles.failedListFolder");
  } finally {
    loaded.value = true;
  }
});
</script>

<template>
  <div v-if="service" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">folder_open</span>
      {{ $t("applicationFiles.title") }}
    </div>
    <div class="card-body">
      <div v-if="loaded && !containers.length" class="empty-state">{{ $t("applicationFiles.noContainers") }}</div>
      <template v-else-if="container">
        <div class="form-group" style="max-width: 320px">
          <label>{{ $t("applicationFiles.container") }}</label>
          <select v-model="container">
            <option v-for="c in containers" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <ContainerFiles :base-path="basePath" :container="container" @error="error = $event" />
      </template>
    </div>
  </div>
</template>
