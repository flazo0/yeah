<script setup lang="ts">
import { useServerContext } from "../../composables/useServerContext";
import ServerTerminal from "../../components/ServerTerminal.vue";

const { server } = useServerContext();
</script>

<template>
  <ServerTerminal v-if="server" :server-name="server.name" />
</template>
