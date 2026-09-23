<script setup lang="ts">
import { useServerContext } from "../../composables/useServerContext";
import ServerMetricBars from "../../components/ServerMetricBars.vue";

const { server } = useServerContext();
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">monitor_heart</span>
      Recursos
    </div>
    <div class="card-body">
      <div v-if="server.metricsCheckedAt === null" class="empty-state">
        Sem dados ainda — a primeira checagem roda até 1 minuto depois do servidor conectar.
      </div>
      <ServerMetricBars v-else :server="server" />
    </div>
  </div>
</template>
