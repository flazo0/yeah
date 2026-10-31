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
      {{ $t("databaseGeneral.general") }}
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.engine") }}</div>
          <div class="mono">{{ database.engine }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.image") }}</div>
          <div class="mono">{{ database.image }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.server") }}</div>
          <div>{{ database.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("databaseGeneral.internalName") }}</div>
          <div class="mono">{{ database.internalHost }}</div>
        </div>
        <div v-if="database.publicAccess">
          <div class="stat-label">{{ $t("databaseGeneral.externalPort") }}</div>
          <div class="mono">{{ database.port }}</div>
        </div>
        <div v-if="database.username">
          <div class="stat-label">{{ $t("databaseGeneral.user") }}</div>
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
      :hint="$t('databaseGeneral.recreatesContainerImmediatelySave')"
      :saved-message="$t('databaseGeneral.savedRecreatingContainer')"
      @saved="(limits) => { database!.memoryLimitMb = limits.memoryLimitMb; database!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />

    <div class="card">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">history</span> {{ $t("databaseGeneral.resourceHistory") }}</div>
      <div class="card-body"><MetricsHistoryChart :fetch-history="fetchHistory" /></div>
    </div>
  </div>
</template>
