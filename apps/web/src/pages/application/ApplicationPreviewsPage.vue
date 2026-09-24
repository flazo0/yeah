<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ApplicationDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import StatusBadge from "../../components/StatusBadge.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

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
    error.value = err instanceof ApiError ? err.message : "falha ao carregar os previews";
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
    error.value = err instanceof ApiError ? err.message : "falha ao atualizar";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="app">
    <div v-if="app.previewOfId" class="card" style="margin-bottom: 0">
      <div class="card-body">
        <p class="hint">Este é um <strong>preview</strong> do pull request #{{ app.prNumber }}: nasce quando o PR abre, atualiza a cada push e some quando o PR fecha.</p>
      </div>
    </div>

    <template v-else>
      <div class="card mb-16">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">preview</span>
          Preview deployments
        </div>
        <div class="card-body">
          <p class="hint mb-16">
            Cada pull request contra <span class="mono">{{ app.branch }}</span> de <span class="mono">{{ app.githubRepo || "—" }}</span> ganha uma cópia desta aplicação,
            construída da branch do PR, num domínio próprio (<span class="mono">pr-N-nome.seu-wildcard</span>). O yeah comenta a URL no PR e apaga tudo quando ele fecha.
            A cópia leva as mesmas variáveis de ambiente e volumes <strong>novos e vazios</strong> — nunca os dados da aplicação principal. PRs vindos de forks são ignorados
            (rodariam código de fora ao lado das suas variáveis).
          </p>
          <p class="hint mb-16">Precisa de: aplicação ligada ao GitHub (GitHub App, com permissão pra comentar em pull requests) e servidor com proxy ativo + domínio wildcard.</p>
          <div class="btn-row">
            <button v-if="!app.previewEnabled" type="button" class="btn" :disabled="busy" @click="toggle(true)">Ativar previews</button>
            <template v-else>
              <span class="badge">ativo</span>
              <button type="button" class="btn btn-secondary" :disabled="busy" @click="toggle(false)">Desativar</button>
            </template>
          </div>
          <p v-if="app.previewEnabled" class="hint" style="margin-top: 8px">Desativar não apaga os previews que já existem — eles saem quando o PR fechar ou você excluir a aplicação.</p>
        </div>
      </div>

      <div class="card" style="margin-bottom: 0">
        <div class="card-header">Previews em andamento</div>
        <div class="card-body">
          <p v-if="previews.length === 0" class="hint">Nenhum preview agora.</p>
          <table v-else class="env-table">
            <thead><tr><th>PR</th><th>Branch</th><th>Status</th><th>URL</th></tr></thead>
            <tbody>
              <tr v-for="p in previews" :key="p.id">
                <td data-label="PR"><RouterLink :to="previewPath(p.id)" class="label-link">#{{ p.prNumber }}</RouterLink></td>
                <td data-label="Branch" class="mono">{{ p.branch }}</td>
                <td data-label="Status"><StatusBadge :status="p.status" /></td>
                <td data-label="URL"><a v-if="p.domain" :href="`https://${p.domain}`" target="_blank" rel="noopener" class="mono label-link">{{ p.domain }}</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
