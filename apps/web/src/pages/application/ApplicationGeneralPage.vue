<script setup lang="ts">
import DomainCard from "../../components/DomainCard.vue";
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error } = useApplicationContext();
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Repositório</div>
          <div class="mono">{{ app.repoUrl }}</div>
        </div>
        <div>
          <div class="stat-label">Branch</div>
          <div class="mono">{{ app.branch }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ app.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ app.port }}</div>
        </div>
        <div>
          <div class="stat-label">Build pack</div>
          <div class="mono">{{ app.buildPack }}</div>
        </div>
      </div>
    </div>

    <DomainCard
      :domain="app.domain"
      :put-url="`${basePath}/domain`"
      saved-message="salvo — aplica no próximo deploy"
      @saved="(domain) => (app!.domain = domain)"
      @error="(msg) => (error = msg)"
    />

    <ResourceLimitsCard
      :memory-limit-mb="app.memoryLimitMb"
      :cpu-limit="app.cpuLimit"
      :put-url="`${basePath}/limits`"
      hint="Aplica no próximo deploy."
      saved-message="salvo — aplica no próximo deploy"
      @saved="(limits) => { app!.memoryLimitMb = limits.memoryLimitMb; app!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />
  </div>
</template>
