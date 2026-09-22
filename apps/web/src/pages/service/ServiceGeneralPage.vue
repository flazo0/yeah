<script setup lang="ts">
import DomainCard from "../../components/DomainCard.vue";
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import { useServiceContext } from "../../composables/useServiceContext";

const { service, basePath, error } = useServiceContext();
</script>

<template>
  <div v-if="service" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Catálogo</div>
          <div class="mono">{{ service.catalogKey }}</div>
        </div>
        <div>
          <div class="stat-label">Imagem</div>
          <div class="mono">{{ service.image }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ service.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ service.port }}</div>
        </div>
      </div>
    </div>

    <DomainCard
      :domain="service.domain"
      :put-url="`${basePath}/domain`"
      saved-message="salvo — reimplante pra aplicar"
      @saved="(domain) => (service!.domain = domain)"
      @error="(msg) => (error = msg)"
    />

    <ResourceLimitsCard
      :memory-limit-mb="service.memoryLimitMb"
      :cpu-limit="service.cpuLimit"
      :put-url="`${basePath}/limits`"
      hint="Reimplante pra aplicar."
      saved-message="salvo — reimplante pra aplicar"
      @saved="(limits) => { service!.memoryLimitMb = limits.memoryLimitMb; service!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />
  </div>
</template>
