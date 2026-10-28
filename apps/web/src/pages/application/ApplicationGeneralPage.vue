<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { resourceSlug, type ServerDto } from "@yeah/shared";
import { api } from "../../lib/api";
import AppDomainsCard from "../../components/AppDomainsCard.vue";
import AppSleepCard from "../../components/AppSleepCard.vue";
import AppProtectionCard from "../../components/AppProtectionCard.vue";
import ResourceLimitsCard from "../../components/ResourceLimitsCard.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error, reloadApp } = useApplicationContext();
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
      {{ $t("applicationGeneral.geral") }}
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div v-if="app.buildPack === 'image'">
          <div class="stat-label">{{ $t("applicationGeneral.imagem") }}</div>
          <div class="mono">{{ app.dockerImage }}</div>
        </div>
        <div v-else-if="app.buildPack === 'dockerfile_inline'">
          <div class="stat-label">{{ $t("applicationGeneral.origem") }}</div>
          <div>{{ $t("applicationGeneral.dockerfileColado") }}</div>
        </div>
        <template v-else>
          <div>
            <div class="stat-label">{{ $t("applicationGeneral.repositorio") }}</div>
            <div class="mono">{{ app.repoUrl }}</div>
          </div>
          <div>
            <div class="stat-label">{{ $t("applicationGeneral.branch") }}</div>
            <div class="mono">{{ app.branch }}</div>
          </div>
        </template>
        <template v-if="app.buildPack === 'docker_compose'">
          <div>
            <div class="stat-label">{{ $t("applicationGeneral.arquivoCompose") }}</div>
            <div class="mono">{{ app.composeFile }}</div>
          </div>
          <div>
            <div class="stat-label">{{ $t("applicationGeneral.servicoDoDominio") }}</div>
            <div class="mono">{{ app.composeService || "—" }}</div>
          </div>
        </template>
        <div v-if="app.buildPack === 'static'">
          <div class="stat-label">{{ $t("applicationGeneral.pastaPublicada") }}</div>
          <div class="mono">{{ app.publishDirectory }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("applicationGeneral.servidor") }}</div>
          <div>{{ app.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("applicationGeneral.porta") }}</div>
          <div class="mono">{{ app.port }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("applicationGeneral.buildPack") }}</div>
          <div class="mono">{{ app.buildPack }}</div>
        </div>
      </div>
      <div v-if="app.deployKeyPublic" class="callout" style="margin-top: 16px">
        <strong>{{ $t("applicationGeneral.deployKey") }}</strong>
        <p class="hint" style="margin: 4px 0 8px">
          {{ $t("applicationGeneral.cadastreEstaChavePublicaNo") }}
        </p>
        <pre class="callout-code" style="margin: 0">{{ app.deployKeyPublic }}</pre>
      </div>
    </div>

    <AppDomainsCard
      :domain="app.domain"
      :extra-domains="app.extraDomains"
      :www-redirect="app.wwwRedirect"
      :put-url="`${basePath}/domain`"
      :suggestion="suggestion"
      :saved-message="app.buildPack === 'docker_compose' ? $t('applicationGeneral.salvoAplicaNoProximoDeploy') : 'salvo — aplica na hora, sem precisar reimplantar'"
      @saved="(v) => { app!.domain = v.domain; app!.extraDomains = v.extraDomains; app!.wwwRedirect = v.wwwRedirect; void reloadApp(); }"
      @error="(msg) => (error = msg)"
    />

    <AppSleepCard
      v-if="app.buildPack !== 'docker_compose'"
      :sleep-after-minutes="app.sleepAfterMinutes"
      :has-domain="!!app.domain"
      :put-url="`${basePath}/sleep`"
      @saved="(v) => { app!.sleepAfterMinutes = v; }"
      @error="(msg) => (error = msg)"
    />

    <AppProtectionCard
      v-if="app.buildPack !== 'docker_compose'"
      :basic-auth-user="app.basicAuthUser"
      :maintenance-mode="app.maintenanceMode"
      :maintenance-message="app.maintenanceMessage"
      :has-domain="!!app.domain"
      :put-url="`${basePath}/protection`"
      @saved="(v) => { app!.basicAuthUser = v.basicAuthUser; app!.maintenanceMode = v.maintenanceMode; app!.maintenanceMessage = v.maintenanceMessage; }"
      @error="(msg) => (error = msg)"
    />

    <ResourceLimitsCard
      :memory-limit-mb="app.memoryLimitMb"
      :cpu-limit="app.cpuLimit"
      :put-url="`${basePath}/limits`"
      :hint="$t('applicationGeneral.aplicaNoProximoDeploy')"
      :saved-message="$t('applicationGeneral.salvoAplicaNoProximoDeploy')"
      @saved="(limits) => { app!.memoryLimitMb = limits.memoryLimitMb; app!.cpuLimit = limits.cpuLimit; }"
      @error="(msg) => (error = msg)"
    />
  </div>
</template>
