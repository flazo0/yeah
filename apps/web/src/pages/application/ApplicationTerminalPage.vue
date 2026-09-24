<script setup lang="ts">
import { useApplicationContext } from "../../composables/useApplicationContext";
import TerminalView from "../../components/TerminalView.vue";

const { app, basePath } = useApplicationContext();
</script>

<template>
  <div v-if="app">
    <p class="hint mb-16">
      Shell dentro do container (<span class="mono">docker exec -it</span>; bash se existir, senão sh). O container precisa estar rodando.
      Em aplicações Docker Compose entra no primeiro container do serviço do domínio.
    </p>
    <TerminalView :path="`${basePath}/terminal`" :title="`Terminal — ${app.name}`" />
  </div>
</template>
