<script setup lang="ts">
import { useServerContext } from "../../composables/useServerContext";
import TerminalView from "../../components/TerminalView.vue";

const { server, teamId } = useServerContext();
</script>

<template>
  <div v-if="server">
    <p class="hint mb-16">{{ $t("serverTerminal.shellDeLoginEm") }} <span class="mono">{{ server.sshUser }}@{{ server.host }}</span>{{ $t("serverTerminal.pelaMesmaChaveSshQue") }}</p>
    <TerminalView :path="`/teams/${teamId}/servers/${server.id}/terminal`" :title="`Terminal — ${server.name}`" />
  </div>
</template>
