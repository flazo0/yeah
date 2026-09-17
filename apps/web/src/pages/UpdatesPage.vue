<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api, ApiError } from "../lib/api";

const route = useRoute();
const teamId = route.params.teamId as string;

interface PlatformUpdate {
  currentCommit: string | null;
  latestCommit: string | null;
  updateAvailable: boolean | null;
  compareUrl: string | null;
}

interface ImageUpdate {
  image: string;
  currentTag: string;
  latestTag: string | null;
  updateAvailable: boolean | null;
}

const platform = ref<PlatformUpdate | null>(null);
const images = ref<ImageUpdate[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [platformRes, imagesRes] = await Promise.all([
      api.get<PlatformUpdate>("/updates/platform"),
      api.get<{ images: ImageUpdate[] }>(`/teams/${teamId}/updates/images`),
    ]);
    platform.value = platformRes;
    images.value = imagesRes.images;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao checar atualizações";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Atualizações</h1>
        <p>Checagem manual — nada atualiza sozinho. Pra atualizar a própria plataforma, rode <span class="mono">yeah update</span> no servidor.</p>
      </div>
      <button type="button" class="btn btn-secondary" :disabled="loading" @click="load">
        <span class="material-symbols-outlined" style="font-size: 18px">refresh</span>
        Checar de novo
      </button>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">deployed_code_update</span>
        Plataforma (yeah)
      </div>
      <div v-if="loading" class="card-body"><div class="empty-state">carregando...</div></div>
      <div v-else-if="!platform || platform.currentCommit === null" class="card-body">
        <div class="empty-state">
          Sem versão rastreável aqui (rodando fora de um container de produção — normal em desenvolvimento local).
        </div>
      </div>
      <div v-else class="card-body">
        <div class="grid grid-2">
          <div>
            <div class="stat-label">Commit atual</div>
            <div class="mono">{{ platform.currentCommit.slice(0, 12) }}</div>
          </div>
          <div>
            <div class="stat-label">Último no main</div>
            <div class="mono">{{ platform.latestCommit ? platform.latestCommit.slice(0, 12) : "não foi possível checar" }}</div>
          </div>
        </div>
        <div class="btn-row mt-16" style="margin-top: 16px">
          <span v-if="platform.updateAvailable === true" class="badge badge-warn">atualização disponível</span>
          <span v-else-if="platform.updateAvailable === false" class="badge badge-good">em dia</span>
          <a v-if="platform.compareUrl" :href="platform.compareUrl" target="_blank" rel="noopener" class="label-link">ver mudanças</a>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">inventory_2</span>
        Imagens Docker em uso
      </div>
      <div v-if="loading" class="card-body"><div class="empty-state">carregando...</div></div>
      <div v-else-if="images.length === 0" class="card-body">
        <div class="empty-state">Nenhum banco ou serviço criado ainda pra checar.</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Imagem</th>
              <th>Tag atual</th>
              <th>Tag mais recente</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="img in images" :key="img.image">
              <td class="mono">{{ img.image.split(":")[0] }}</td>
              <td class="mono">{{ img.currentTag }}</td>
              <td class="mono">{{ img.latestTag ?? "-" }}</td>
              <td>
                <span v-if="img.updateAvailable === true" class="badge badge-warn">nova tag disponível</span>
                <span v-else-if="img.updateAvailable === false" class="badge badge-good">em dia</span>
                <span v-else class="badge badge-neutral">não verificável</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="card-body" style="border-top: 1px solid var(--border)">
        <p class="hint">
          Atualizar um recurso é manual: edite a imagem no banco/serviço e rode o provisionamento de novo. Nada aqui reinicia nada sozinho.
        </p>
      </div>
    </div>
  </div>
</template>
