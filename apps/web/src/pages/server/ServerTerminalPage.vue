<script setup lang="ts">
import { useServerContext } from "../../composables/useServerContext";
import TerminalView from "../../components/TerminalView.vue";

const { server, teamId } = useServerContext();
</script>

<template>
  <div v-if="server">
    <p class="hint mb-16">Shell de login em <span class="mono">{{ server.sshUser }}@{{ server.host }}</span>, pela mesma chave SSH que o painel usa. A sessão fecha sozinha depois de 30 min sem digitar.</p>
    <TerminalView :path="`/teams/${teamId}/servers/${server.id}/terminal`" :title="`Terminal — ${server.name}`" />
  </div>
</template>
