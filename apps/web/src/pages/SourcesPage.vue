<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { GithubInstallationDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import StatusBadge from "../components/StatusBadge.vue";

const route = useRoute();
const teamId = route.params.teamId as string;

const configured = ref(true);
const installation = ref<GithubInstallationDto | null>(null);
const loading = ref(true);
const error = ref("");
const connecting = ref(false);
const search = ref("");
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

const sources = computed(() => {
  const q = search.value.trim().toLowerCase();
  const list = installation.value ? [installation.value] : [];
  return list.filter((s) => !q || s.accountLogin.toLowerCase().includes(q));
});

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ configured: boolean; installation: GithubInstallationDto | null }>(`/teams/${teamId}/github`);
    configured.value = res.configured;
    installation.value = res.installation;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar fontes";
  } finally {
    loading.value = false;
  }
}

async function connectGithub() {
  menuOpen.value = false;
  connecting.value = true;
  error.value = "";
  try {
    const res = await api.get<{ url: string }>(`/teams/${teamId}/github/install-url`);
    window.location.href = res.url;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao iniciar conexão";
    connecting.value = false;
  }
}

function onDocumentClick(event: MouseEvent) {
  if (menuRoot.value && !event.composedPath().includes(menuRoot.value)) menuOpen.value = false;
}

onMounted(() => {
  load();
  document.addEventListener("click", onDocumentClick);
});
onUnmounted(() => document.removeEventListener("click", onDocumentClick));
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Fontes</h1>
        <p>
          {{ installation ? "1 fonte Git conectada ao seu time" : "Conecte uma fonte Git pra usar repositórios privados e auto-deploy em cada push." }}
        </p>
      </div>
      <div ref="menuRoot" class="menu-anchor">
        <button type="button" class="btn" :disabled="connecting" @click.stop="menuOpen = !menuOpen">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          Nova fonte
          <span class="material-symbols-outlined" style="font-size: 18px">expand_more</span>
        </button>
        <div v-if="menuOpen" class="menu-pop">
          <button type="button" class="menu-item" :disabled="!configured" @click="connectGithub">
            <span class="material-symbols-outlined">hub</span>
            GitHub
          </button>
          <button type="button" class="menu-item" disabled>
            <span class="material-symbols-outlined">merge</span>
            GitLab <small class="muted">em breve</small>
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!loading && !configured" class="card mb-16">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">settings</span>
          Este servidor ainda não tem um GitHub App configurado.
          <p class="hint" style="margin-top: 8px">
            Crie um em <span class="mono">github.com/settings/apps/new</span> e defina
            <span class="mono">GITHUB_APP_ID</span>, <span class="mono">GITHUB_APP_SLUG</span>,
            <span class="mono">GITHUB_APP_PRIVATE_KEY_BASE64</span> e <span class="mono">GITHUB_APP_WEBHOOK_SECRET</span>
            nas variáveis de ambiente da API.
          </p>
        </div>
      </div>
    </div>

    <div class="rtable-toolbar">
      <div class="rtable-search input-icon">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" class="form-control" type="search" placeholder="Buscar fontes" aria-label="Buscar fontes" />
      </div>
    </div>

    <PageState :loading="loading" :empty="!installation" empty-icon="hub" empty-text="Nenhuma fonte conectada ainda. Use “Nova fonte” pra conectar o GitHub.">
      <div v-if="sources.length === 0" class="empty-state">Nenhuma fonte bate com a busca.</div>
      <div v-else class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Provedor</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id">
              <td data-label="Fonte">
                <RouterLink :to="`/teams/${teamId}/sources/${source.id}`" class="rtable-name">
                  <span class="rtable-icon"><span class="material-symbols-outlined">hub</span></span>
                  <strong>{{ source.accountLogin }}</strong>
                </RouterLink>
              </td>
              <td data-label="Provedor">GitHub · {{ source.accountType }}</td>
              <td data-label="Status"><StatusBadge status="connected" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageState>
  </div>
</template>
