<script setup lang="ts">
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import { useDatabaseContext } from "../../composables/useDatabaseContext";

const { database, basePath, error } = useDatabaseContext();
</script>

<template>
  <div v-if="database" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Motor</div>
          <div class="mono">{{ database.engine }}</div>
        </div>
        <div>
          <div class="stat-label">Imagem</div>
          <div class="mono">{{ database.image }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ database.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ database.port }}</div>
        </div>
        <div v-if="database.username">
          <div class="stat-label">Usuário</div>
          <div class="mono">{{ database.username }}</div>
        </div>
        <div v-if="database.databaseName">
          <div class="stat-label">Database</div>
          <div class="mono">{{ database.databaseName }}</div>
        </div>
      </div>
    </div>

    <ResourceLimitsCard
      :memory-limit-mb="database.memoryLimitMb"
      :cpu-limit="database.cpuLimit"
      :put-url="`${basePath}/limits`"
      hint="Recria o container imediatamente ao salvar."
      saved-message="salvo — recriando container"
      @saved="(limits) => { database!.memoryLimitMb = limits.memoryLimitMb; database!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />
  </div>
</template>
