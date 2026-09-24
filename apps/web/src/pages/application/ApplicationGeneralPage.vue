<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { resourceSlug, type ServerDto } from "@yeah/shared";
import { api } from "../../lib/api";
import DomainCard from "../../components/DomainCard.vue";
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error } = useApplicationContext();
const route = useRoute();

const wildcard = ref<string | null>(null);
onMounted(async () => {
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${route.params.teamId}/servers`);
    wildcard.value = res.servers.find((s) => s.id === app.value?.serverId)?.wildcardDomain ?? null;
  } catch {
    wildcard.value = null;
  }
});
const suggestion = computed(() => (app.value && wildcard.value ? `${resourceSlug(app.value.name)}.${wildcard.value}` : null));
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div v-if="app.buildPack === 'image'">
          <div class="stat-label">Imagem</div>
          <div class="mono">{{ app.dockerImage }}</div>
        </div>
        <div v-else-if="app.buildPack === 'dockerfile_inline'">
          <div class="stat-label">Origem</div>
          <div>Dockerfile colado</div>
        </div>
        <template v-else>
          <div>
            <div class="stat-label">Repositório</div>
            <div class="mono">{{ app.repoUrl }}</div>
          </div>
          <div>
            <div class="stat-label">Branch</div>
            <div class="mono">{{ app.branch }}</div>
          </div>
        </template>
        <template v-if="app.buildPack === 'docker_compose'">
          <div>
            <div class="stat-label">Arquivo compose</div>
            <div class="mono">{{ app.composeFile }}</div>
          </div>
          <div>
            <div class="stat-label">Serviço do domínio</div>
            <div class="mono">{{ app.composeService || "—" }}</div>
          </div>
        </template>
        <div v-if="app.buildPack === 'static'">
          <div class="stat-label">Pasta publicada</div>
          <div class="mono">{{ app.publishDirectory }}</div>
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
      <div v-if="app.deployKeyPublic" class="callout" style="margin-top: 16px">
        <strong>Deploy key</strong>
        <p class="hint" style="margin: 4px 0 8px">
          Cadastre esta chave pública no repositório como deploy key (acesso só de leitura), senão o clone falha. A privada fica guardada criptografada no painel.
        </p>
        <pre class="callout-code" style="margin: 0">{{ app.deployKeyPublic }}</pre>
      </div>
    </div>

    <DomainCard
      :domain="app.domain"
      :put-url="`${basePath}/domain`"
      :suggestion="suggestion"
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
