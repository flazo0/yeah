<script setup lang="ts">
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import DatabaseConnectionCard from "../../components/DatabaseConnectionCard.vue";
import MetricsHistoryChart from "../../components/MetricsHistoryChart.vue";
import { api } from "../../lib/api";
import { useDatabaseContext } from "../../composables/useDatabaseContext";

const { database, basePath, error } = useDatabaseContext();

function fetchHistory(hours: number) {
  return api.get<{ history: { at: string; cpu: number; mem: number }[] }>(`${basePath}/metrics-history?hours=${hours}`);
}
</script>

<template>
  <div v-if="database" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      {{ $t("databaseGeneral.geral") }}
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.motor") }}</div>
          <div class="mono">{{ database.engine }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.imagem") }}</div>
          <div class="mono">{{ database.image }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.servidor") }}</div>
          <div>{{ database.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.nomeInterno") }}</div>
          <div class="mono">{{ database.internalHost }}</div>
        </div>
        <div v-if="database.publicAccess">
          <div class="stat-label">{{ $t("databaseGeneral.portaExterna") }}</div>
          <div class="mono">{{ database.port }}</div>
        </div>
        <div v-if="database.username">
          <div class="stat-label">{{ $t("databaseGeneral.usuario") }}</div>
          <div class="mono">{{ database.username }}</div>
        </div>
        <div v-if="database.databaseName">
          <div class="stat-label">{{ $t("databaseGeneral.database") }}</div>
          <div class="mono">{{ database.databaseName }}</div>
        </div>
      </div>
    </div>

    <DatabaseConnectionCard :base-path="basePath" :public-access="database.publicAccess" :ssl="database.ssl" @error="(msg) => (error = msg)" />

    <ResourceLimitsCard
      :memory-limit-mb="database.memoryLimitMb"
      :cpu-limit="database.cpuLimit"
      :put-url="`${basePath}/limits`"
      :hint="$t('databaseGeneral.recriaOContainerImediatamenteAo')"
      :saved-message="$t('databaseGeneral.salvoRecriandoContainer')"
      @saved="(limits) => { database!.memoryLimitMb = limits.memoryLimitMb; database!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />

    <div class="card">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">history</span> {{ $t("databaseGeneral.historicoDeRecursos") }}</div>
      <div class="card-body"><MetricsHistoryChart :fetch-history="fetchHistory" /></div>
    </div>
  </div>
</template>
