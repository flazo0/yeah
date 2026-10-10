<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ApplicationDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import StatusBadge from "../../components/StatusBadge.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

interface PreviewRow {
  id: string;
  name: string;
  prNumber: number | null;
  branch: string;
  domain: string | null;
  status: string;
}

const { app, basePath, error, reloadApp } = useApplicationContext();
const route = useRoute();
const previews = ref<PreviewRow[]>([]);
const busy = ref(false);
const previewPath = (id: string) =>
  `/teams/${route.params.teamId}/projects/${route.params.projectId}/environments/${route.params.environmentId}/apps/${id}/deployments`;

async function loadPreviews() {
  try {
    previews.value = (await api.get<{ previews: PreviewRow[] }>(`${basePath}/previews`)).previews;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationPreviews.falhaAoCarregarOsPreviews");
  }
}
onMounted(loadPreviews);

async function toggle(enabled: boolean) {
  busy.value = true;
  error.value = "";
  try {
    const res = await api.put<{ application: ApplicationDto }>(`${basePath}/preview`, { enabled });
    if (app.value) app.value.previewEnabled = res.application.previewEnabled;
    await reloadApp();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationPreviews.falhaAoAtualizar");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="app">
    <div v-if="app.previewOfId" class="card" style="margin-bottom: 0">
      <div class="card-body">
        <p class="hint">{{ $t("applicationPreviews.esteEUm") }} <strong>{{ $t("applicationPreviews.preview") }}</strong> {{ $t("applicationPreviews.doPullRequestP0Nasce", { p0: app.prNumber }) }}</p>
      </div>
    </div>

    <template v-else>
      <div class="card mb-16">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">preview</span>
          {{ $t("applicationPreviews.previewDeployments") }}
        </div>
        <div class="card-body">
          <p class="hint mb-16">
            {{ $t("applicationPreviews.cadaPullRequestContra") }} <span class="mono">{{ app.branch }}</span> {{ $t("applicationPreviews.de") }} <span class="mono">{{ app.githubRepo || "—" }}</span> {{ $t("applicationPreviews.ganhaUmaCopiaDestaAplicacao") }}<span class="mono">{{ $t("applicationPreviews.prNNomeSeuWildcard") }}</span>{{ $t("applicationPreviews.oYeahComentaAUrl") }} <strong>{{ $t("applicationPreviews.novosEVazios") }}</strong> {{ $t("applicationPreviews.nuncaOsDadosDaAplicacao") }}
          </p>
          <p class="hint mb-16">{{ $t("applicationPreviews.precisaDeAplicacaoLigadaAo") }}</p>
          <div class="btn-row">
            <button v-if="!app.previewEnabled" type="button" class="btn" :disabled="busy" @click="toggle(true)">{{ $t("applicationPreviews.ativarPreviews") }}</button>
            <template v-else>
              <span class="badge">{{ $t("applicationPreviews.ativo") }}</span>
              <button type="button" class="btn btn-secondary" :disabled="busy" @click="toggle(false)">{{ $t("applicationPreviews.desativar") }}</button>
            </template>
          </div>
          <p v-if="app.previewEnabled" class="hint" style="margin-top: 8px">{{ $t("applicationPreviews.desativarNaoApagaOsPreviews") }}</p>
        </div>
      </div>

      <div class="card" style="margin-bottom: 0">
        <div class="card-header">{{ $t("applicationPreviews.previewsEmAndamento") }}</div>
        <div class="card-body">
          <p v-if="previews.length === 0" class="hint">{{ $t("applicationPreviews.nenhumPreviewAgora") }}</p>
          <table v-else class="env-table">
            <thead><tr><th>{{ $t("applicationPreviews.pr") }}</th><th>{{ $t("applicationPreviews.branch") }}</th><th>{{ $t("applicationPreviews.status") }}</th><th>{{ $t("applicationPreviews.url") }}</th></tr></thead>
            <tbody>
              <tr v-for="p in previews" :key="p.id">
                <td :data-label="$t('applicationPreviews.labelPr')"><RouterLink :to="previewPath(p.id)" class="label-link">#{{ p.prNumber }}</RouterLink></td>
                <td :data-label="$t('applicationPreviews.labelBranch')" class="mono">{{ p.branch }}</td>
                <td :data-label="$t('applicationPreviews.labelStatus')"><StatusBadge :status="p.status" /></td>
                <td :data-label="$t('applicationPreviews.labelUrl')"><a v-if="p.domain" :href="`https://${p.domain}`" target="_blank" rel="noopener" class="mono label-link">{{ p.domain }}</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
