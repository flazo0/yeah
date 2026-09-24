<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { GIT_PROVIDER_DEFAULT_URL, GIT_PROVIDER_LABELS, GIT_PROVIDERS, type GitProvider, type GitSourceDto, type GithubInstallationDto } from "@yeah/shared";
import { apiBaseUrl } from "../lib/api";
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

// ---- GitLab / Bitbucket / Gitea sources (access-token based)
const gitSources = ref<GitSourceDto[]>([]);
const gitForm = ref<{ provider: GitProvider; name: string; baseUrl: string; username: string; token: string }>({ provider: "gitlab", name: "", baseUrl: "", username: "", token: "" });
const gitFormOpen = ref(false);
const gitBusy = ref(false);
const revealed = ref<Record<string, { secret: string; url: string }>>({});
const confirmingGitId = ref<string | null>(null);
let gitConfirmTimer: ReturnType<typeof setTimeout> | undefined;

async function loadGitSources() {
  try {
    gitSources.value = (await api.get<{ sources: GitSourceDto[] }>(`/teams/${teamId}/git-sources`)).sources;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar as fontes Git";
  }
}

function openGitForm(provider: GitProvider) {
  menuOpen.value = false;
  gitForm.value = { provider, name: GIT_PROVIDER_LABELS[provider], baseUrl: GIT_PROVIDER_DEFAULT_URL[provider] ?? "", username: "", token: "" };
  gitFormOpen.value = true;
}

async function saveGitSource() {
  gitBusy.value = true;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/git-sources`, gitForm.value);
    gitFormOpen.value = false;
    await loadGitSources();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar a fonte";
  } finally {
    gitBusy.value = false;
  }
}

async function revealWebhook(source: GitSourceDto) {
  try {
    const res = await api.get<{ secret: string; path: string }>(`/teams/${teamId}/git-sources/${source.id}/webhook-secret`);
    revealed.value = { ...revealed.value, [source.id]: { secret: res.secret, url: `${apiBaseUrl()}${res.path}` } };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao ler o segredo";
  }
}

async function removeGitSource(source: GitSourceDto) {
  if (confirmingGitId.value !== source.id) {
    confirmingGitId.value = source.id;
    clearTimeout(gitConfirmTimer);
    gitConfirmTimer = setTimeout(() => (confirmingGitId.value = null), 3000);
    return;
  }
  try {
    await api.delete(`/teams/${teamId}/git-sources/${source.id}`);
    gitSources.value = gitSources.value.filter((s) => s.id !== source.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover a fonte";
  } finally {
    confirmingGitId.value = null;
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
  void loadGitSources();
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
          <button v-for="p in GIT_PROVIDERS" :key="p" type="button" class="menu-item" @click="openGitForm(p)">
            <span class="material-symbols-outlined">merge</span>
            {{ GIT_PROVIDER_LABELS[p] }}
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

    <form v-if="gitFormOpen" class="card mb-16" @submit.prevent="saveGitSource">
      <div class="card-header">Nova fonte — {{ GIT_PROVIDER_LABELS[gitForm.provider] }}</div>
      <div class="card-body">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="gs-name">Nome</label>
            <input id="gs-name" v-model="gitForm.name" class="form-control" required />
          </div>
          <div v-if="gitForm.provider !== 'bitbucket'" class="form-group" style="margin-bottom: 0">
            <label for="gs-url">URL do servidor</label>
            <input id="gs-url" v-model="gitForm.baseUrl" class="form-control mono" placeholder="https://git.exemplo.com" required />
          </div>
        </div>
        <div class="form-row mb-16">
          <div v-if="gitForm.provider !== 'gitlab'" class="form-group" style="margin-bottom: 0">
            <label for="gs-user">Usuário</label>
            <input id="gs-user" v-model="gitForm.username" class="form-control mono" autocomplete="off" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="gs-token">{{ gitForm.provider === "bitbucket" ? "Senha de app" : "Token de acesso" }}</label>
            <input id="gs-token" v-model="gitForm.token" type="password" class="form-control" autocomplete="new-password" required />
          </div>
        </div>
        <p class="hint mb-16">
          <template v-if="gitForm.provider === 'gitlab'">Um token de acesso pessoal ou de projeto com escopo <span class="mono">read_api</span> e <span class="mono">read_repository</span>.</template>
          <template v-else-if="gitForm.provider === 'gitea'">Um token de acesso da conta (Configurações → Aplicativos) com leitura de repositórios.</template>
          <template v-else>Uma senha de app do Bitbucket (Configurações pessoais → Senhas de app) com leitura de repositórios.</template>
          O token fica criptografado e nunca é mostrado de volta.
        </p>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="gitBusy">Salvar fonte</button>
          <button type="button" class="btn btn-secondary" @click="gitFormOpen = false">Cancelar</button>
        </div>
      </div>
    </form>

    <div v-if="gitSources.length > 0" class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">merge</span>
        GitLab, Bitbucket e Gitea
      </div>
      <div class="card-body">
        <div v-for="source in gitSources" :key="source.id" class="git-source">
          <div class="btn-row" style="justify-content: space-between; align-items: flex-start">
            <div>
              <strong>{{ source.name }}</strong>
              <span class="badge" style="margin-left: 8px">{{ GIT_PROVIDER_LABELS[source.provider] }}</span>
              <div class="hint mono">{{ source.baseUrl }}<template v-if="source.username"> · {{ source.username }}</template></div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-secondary btn-sm" @click="revealWebhook(source)">Webhook</button>
              <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="removeGitSource(source)">{{ confirmingGitId === source.id ? "Confirmar?" : "Remover" }}</button>
            </div>
          </div>
          <div v-if="revealed[source.id]" class="callout" style="margin-top: 8px">
            <p class="hint" style="margin: 0 0 6px">
              Cadastre este webhook de <strong>push</strong> no provedor (em cada repositório ou no grupo) pra ter auto-deploy.
              <template v-if="source.provider === 'gitlab'">No GitLab, o segredo vai no campo "Secret token".</template>
              <template v-else-if="source.provider === 'gitea'">No Gitea, o segredo vai no campo "Secret".</template>
              <template v-else>No Bitbucket, o segredo vai no campo "Secret" do webhook (evento: Repository push).</template>
            </p>
            <div class="stat-label">URL</div>
            <pre class="callout-code" style="margin: 0 0 6px">{{ revealed[source.id]!.url }}</pre>
            <div class="stat-label">Segredo</div>
            <pre class="callout-code" style="margin: 0">{{ revealed[source.id]!.secret }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
