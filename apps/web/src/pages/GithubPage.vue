<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import type { GithubInstallationDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";

const route = useRoute();
const teamId = route.params.teamId as string;

const configured = ref(true);
const installation = ref<GithubInstallationDto | null>(null);
const loading = ref(true);
const error = ref("");
const connecting = ref(false);
const disconnecting = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ configured: boolean; installation: GithubInstallationDto | null }>(
      `/teams/${teamId}/github`,
    );
    configured.value = res.configured;
    installation.value = res.installation;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar conexão com o GitHub";
  } finally {
    loading.value = false;
  }
}

async function connect() {
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

async function disconnect() {
  disconnecting.value = true;
  try {
    await api.delete(`/teams/${teamId}/github`);
    installation.value = null;
  } finally {
    disconnecting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>GitHub</h1>
        <p>Conecte um GitHub App pra escolher repositórios direto da lista e fazer auto-deploy em cada push.</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="loading" class="card"><div class="card-body"><div class="empty-state">carregando...</div></div></div>

    <div v-else-if="!configured" class="card">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">settings</span>
          Este servidor ainda não tem um GitHub App configurado.
          <p class="hint mt-16" style="margin-top: 8px">
            Crie um em <span class="mono">github.com/settings/apps/new</span> e defina
            <span class="mono">GITHUB_APP_ID</span>, <span class="mono">GITHUB_APP_SLUG</span>,
            <span class="mono">GITHUB_APP_PRIVATE_KEY_BASE64</span> e <span class="mono">GITHUB_APP_WEBHOOK_SECRET</span>
            nas variáveis de ambiente da API.
          </p>
        </div>
      </div>
    </div>

    <div v-else-if="!installation" class="card">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">hub</span>
          Nenhuma conta conectada ainda.
        </div>
        <div class="btn-row" style="justify-content: center; margin-top: 16px">
          <button type="button" class="btn" :disabled="connecting" @click="connect">
            <span class="material-symbols-outlined" style="font-size: 18px">hub</span>
            {{ connecting ? "abrindo..." : "Conectar GitHub" }}
          </button>
        </div>
      </div>
    </div>

    <div v-else class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">hub</span>
        Conectado
      </div>
      <div class="card-body">
        <div class="btn-row mb-16">
          <span class="mono" style="align-self: center">{{ installation.accountLogin }} ({{ installation.accountType }})</span>
          <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" :disabled="disconnecting" @click="disconnect">
            <span class="material-symbols-outlined" style="font-size: 16px">link_off</span>
            {{ disconnecting ? "desconectando..." : "Desconectar" }}
          </button>
        </div>
        <p class="hint">Agora dá pra escolher um repositório dessa conta direto no formulário de nova aplicação.</p>
      </div>
    </div>
  </div>
</template>
