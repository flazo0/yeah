<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { GIT_PROVIDER_DEFAULT_URL, GIT_PROVIDER_LABELS, GIT_PROVIDERS, type GitProvider, type GitSourceDto, type GithubInstallationDto } from "@yeah/shared";
import { apiBaseUrl } from "../lib/api";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { i18n } from "../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sources.falhaAoCarregarFontes");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sources.falhaAoCarregarAsFontes");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sources.falhaAoSalvarAFonte");
  } finally {
    gitBusy.value = false;
  }
}

async function revealWebhook(source: GitSourceDto) {
  try {
    const res = await api.get<{ secret: string; path: string }>(`/teams/${teamId}/git-sources/${source.id}/webhook-secret`);
    revealed.value = { ...revealed.value, [source.id]: { secret: res.secret, url: `${apiBaseUrl()}${res.path}` } };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sources.falhaAoLerOSegredo");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sources.falhaAoRemoverAFonte");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sources.falhaAoIniciarConexao");
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
        <h1>{{ $t("sources.fontes") }}</h1>
        <p>
          {{ installation ? "1 fonte Git conectada ao seu time" : $t("sources.conecteUmaFonteGitPra") }}
        </p>
      </div>
      <div ref="menuRoot" class="menu-anchor">
        <button type="button" class="btn" :disabled="connecting" @click.stop="menuOpen = !menuOpen">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ $t("sources.novaFonte") }}
          <span class="material-symbols-outlined" style="font-size: 18px">expand_more</span>
        </button>
        <div v-if="menuOpen" class="menu-pop">
          <button type="button" class="menu-item" :disabled="!configured" @click="connectGithub">
            <span class="material-symbols-outlined">hub</span>
            {{ $t("sources.github") }}
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
          {{ $t("sources.esteServidorAindaNaoTem") }}
          <p class="hint" style="margin-top: 8px">
            {{ $t("sources.crieUmEm") }} <span class="mono">{{ $t("sources.githubComSettingsAppsNew") }}</span> {{ $t("sources.eDefina") }}
            <span class="mono">{{ $t("sources.githubAppId") }}</span>, <span class="mono">{{ $t("sources.githubAppSlug") }}</span>,
            <span class="mono">{{ $t("sources.githubAppPrivateKeyBase64") }}</span> {{ $t("sources.e") }} <span class="mono">{{ $t("sources.githubAppWebhookSecret") }}</span>
            {{ $t("sources.nasVariaveisDeAmbienteDa") }}
          </p>
        </div>
      </div>
    </div>

    <div class="rtable-toolbar">
      <div class="rtable-search input-icon">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" class="form-control" type="search" :placeholder="$t('sources.buscarFontes')" :aria-label="$t('sources.buscarFontes')" />
      </div>
    </div>

    <PageState :loading="loading" :empty="!installation" empty-icon="hub" :empty-text="$t('sources.nenhumaFonteConectadaAindaUse')">
      <div v-if="sources.length === 0" class="empty-state">{{ $t("sources.nenhumaFonteBateComA") }}</div>
      <div v-else class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>{{ $t("sources.fonte") }}</th>
              <th>{{ $t("sources.provedor") }}</th>
              <th>{{ $t("sources.status") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id">
              <td :data-label="$t('sources.labelFonte')">
                <RouterLink :to="`/teams/${teamId}/sources/${source.id}`" class="rtable-name">
                  <span class="rtable-icon"><span class="material-symbols-outlined">hub</span></span>
                  <strong>{{ source.accountLogin }}</strong>
                </RouterLink>
              </td>
              <td :data-label="$t('sources.labelProvedor')">{{ $t("sources.githubP0", { p0: source.accountType }) }}</td>
              <td :data-label="$t('sources.labelStatus')"><StatusBadge status="connected" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageState>

    <form v-if="gitFormOpen" class="card mb-16" @submit.prevent="saveGitSource">
      <div class="card-header">{{ $t("sources.novaFonteP0", { p0: GIT_PROVIDER_LABELS[gitForm.provider] }) }}</div>
      <div class="card-body">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="gs-name">{{ $t("sources.nome") }}</label>
            <input id="gs-name" v-model="gitForm.name" class="form-control" required />
          </div>
          <div v-if="gitForm.provider !== 'bitbucket'" class="form-group" style="margin-bottom: 0">
            <label for="gs-url">{{ $t("sources.urlDoServidor") }}</label>
            <input id="gs-url" v-model="gitForm.baseUrl" class="form-control mono" placeholder="https://git.exemplo.com" required />
          </div>
        </div>
        <div class="form-row mb-16">
          <div v-if="gitForm.provider !== 'gitlab'" class="form-group" style="margin-bottom: 0">
            <label for="gs-user">{{ $t("sources.usuario") }}</label>
            <input id="gs-user" v-model="gitForm.username" class="form-control mono" autocomplete="off" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="gs-token">{{ gitForm.provider === "bitbucket" ? $t("sources.senhaDeApp") : $t("sources.tokenDeAcesso") }}</label>
            <input id="gs-token" v-model="gitForm.token" type="password" class="form-control" autocomplete="new-password" required />
          </div>
        </div>
        <p class="hint mb-16">
          <template v-if="gitForm.provider === 'gitlab'">{{ $t("sources.umTokenDeAcessoPessoal") }} <span class="mono">{{ $t("sources.readApi") }}</span> {{ $t("sources.e") }} <span class="mono">{{ $t("sources.readRepository") }}</span>.</template>
          <template v-else-if="gitForm.provider === 'gitea'">{{ $t("sources.umTokenDeAcessoDa") }}</template>
          <template v-else>{{ $t("sources.umaSenhaDeAppDo") }}</template>
          {{ $t("sources.oTokenFicaCriptografadoE") }}
        </p>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="gitBusy">{{ $t("sources.salvarFonte") }}</button>
          <button type="button" class="btn btn-secondary" @click="gitFormOpen = false">{{ $t("sources.cancelar") }}</button>
        </div>
      </div>
    </form>

    <div v-if="gitSources.length > 0" class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">merge</span>
        {{ $t("sources.gitlabBitbucketEGitea") }}
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
              <button type="button" class="btn btn-secondary btn-sm" @click="revealWebhook(source)">{{ $t("sources.webhook") }}</button>
              <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="removeGitSource(source)">{{ confirmingGitId === source.id ? $t('common.confirmQ') : $t('common.remove') }}</button>
            </div>
          </div>
          <div v-if="revealed[source.id]" class="callout" style="margin-top: 8px">
            <p class="hint" style="margin: 0 0 6px">
              {{ $t("sources.cadastreEsteWebhookDe") }} <strong>{{ $t("sources.push") }}</strong> {{ $t("sources.noProvedorEmCadaRepositorio") }}
              <template v-if="source.provider === 'gitlab'">{{ $t("sources.noGitlabOSegredoVai") }}</template>
              <template v-else-if="source.provider === 'gitea'">{{ $t("sources.noGiteaOSegredoVai") }}</template>
              <template v-else>{{ $t("sources.noBitbucketOSegredoVai") }}</template>
            </p>
            <div class="stat-label">{{ $t("sources.url") }}</div>
            <pre class="callout-code" style="margin: 0 0 6px">{{ revealed[source.id]!.url }}</pre>
            <div class="stat-label">{{ $t("sources.segredo") }}</div>
            <pre class="callout-code" style="margin: 0">{{ revealed[source.id]!.secret }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
