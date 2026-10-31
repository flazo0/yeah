<script setup lang="ts">
import { useApplicationContext } from "../../composables/useApplicationContext";
import TerminalView from "../../components/TerminalView.vue";

const { app, basePath } = useApplicationContext();
</script>

<template>
  <div v-if="app">
    <p class="hint mb-16">
      {{ $t("applicationTerminal.shellInsideContainer") }}<span class="mono">{{ $t("applicationTerminal.dockerExecIt") }}</span>{{ $t("applicationTerminal.bashIfAvailableOtherwiseSh") }}
    </p>
    <TerminalView :path="`${basePath}/terminal`" :title="`Terminal — ${app.name}`" />
  </div>
</template>
