<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { GithubInstallationDto, GithubSourceResourceDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { i18n } from "../lib/i18n";
import { dateLocale } from "../lib/i18n";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const sourceId = route.params.sourceId as string;

const installation = ref<GithubInstallationDto | null>(null);
const resources = ref<GithubSourceResourceDto[]>([]);
const loading = ref(true);
const error = ref("");
const confirmingDisconnect = ref(false);
const disconnecting = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const tabs = [
  { key: "general", label: i18n.global.t("common.general"), icon: "tune" },
  { key: "permissions", label: i18n.global.t("sourceDetail.permissoes"), icon: "lock" },
  { key: "resources", label: i18n.global.t("common.resources"), icon: "deployed_code" },
] as const;
const tab = computed(() => tabs.find((t) => t.key === route.query.tab)?.key ?? "general");

const permissions = [
  { name: "Contents", level: "Read", why: i18n.global.t("sourceDetail.clonarORepositorioEBaixar") },
  { name: "Metadata", level: "Read", why: i18n.global.t("sourceDetail.listarOsRepositoriosQueO") },
];

async function load() {
  try {
    const res = await api.get<{ installation: GithubInstallationDto | null }>(`/teams/${teamId}/github`);
    installation.value = res.installation && res.installation.id === sourceId ? res.installation : null;
    if (installation.value) {
      const list = await api.get<{ resources: GithubSourceResourceDto[] }>(`/teams/${teamId}/github/resources`);
      resources.value = list.resources;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sourceDetail.falhaAoCarregarFonte");
  } finally {
    loading.value = false;
  }
}

async function disconnect() {
  if (!confirmingDisconnect.value) {
    confirmingDisconnect.value = true;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingDisconnect.value = false), 4000);
    return;
  }
  disconnecting.value = true;
  try {
    await api.delete(`/teams/${teamId}/github`);
    router.push(`/teams/${teamId}/sources`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sourceDetail.falhaAoDesconectar");
    disconnecting.value = false;
    confirmingDisconnect.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/sources`" class="breadcrumb-item">{{ $t("sourceDetail.fontes") }}</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">{{ installation?.accountLogin ?? "…" }}</span>
    </nav>

    <PageState :loading="loading" :error="error" :empty="!installation" empty-icon="hub" :empty-text="$t('sourceDetail.fonteNaoEncontrada')">
      <template v-if="installation">
        <div class="resource-header">
          <div class="resource-title">
            <span class="material-symbols-outlined">hub</span>
            {{ installation.accountLogin }}
            <StatusBadge status="connected" />
          </div>
          <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="disconnecting" @click="disconnect">
            <span class="material-symbols-outlined" style="font-size: 18px">link_off</span>
            {{ confirmingDisconnect ? $t("sourceDetail.confirmarDesconexao") : "Desconectar" }}
          </button>
        </div>
        <p class="resource-subtitle">{{ $t("sourceDetail.githubP0", { p0: installation.accountType }) }}</p>

        <div class="detail-tabs">
          <RouterLink
            v-for="t in tabs"
            :key="t.key"
            :to="{ query: { tab: t.key } }"
            class="detail-tab"
            :class="{ active: tab === t.key }"
          >
            <span class="material-symbols-outlined" style="font-size: 18px">{{ t.icon }}</span>
            {{ t.label }}
            <span v-if="t.key === 'resources'" class="badge badge-neutral">{{ resources.length }}</span>
          </RouterLink>
        </div>

        <div v-if="tab === 'general'" class="card">
          <div class="card-body">
            <dl class="kv-list">
              <div><dt>{{ $t("sourceDetail.conta") }}</dt><dd class="mono">{{ installation.accountLogin }}</dd></div>
              <div><dt>{{ $t("sourceDetail.tipo") }}</dt><dd>{{ installation.accountType }}</dd></div>
              <div><dt>{{ $t("sourceDetail.installationId") }}</dt><dd class="mono">{{ installation.installationId }}</dd></div>
              <div><dt>{{ $t("sourceDetail.conectadaEm") }}</dt><dd>{{ new Date(installation.createdAt).toLocaleString(dateLocale()) }}</dd></div>
            </dl>
            <p class="hint" style="margin-top: 16px">
              {{ $t("sourceDetail.oAppAChavePrivada") }}
              <span class="mono">{{ $t("sourceDetail.envExample") }}</span>.
            </p>
          </div>
        </div>

        <div v-else-if="tab === 'permissions'" class="card">
          <div class="rtable-wrap" style="border: none">
            <table class="rtable">
              <thead>
                <tr><th>{{ $t("sourceDetail.permissao") }}</th><th>{{ $t("sourceDetail.nivel") }}</th><th>{{ $t("sourceDetail.praQue") }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in permissions" :key="p.name">
                  <td :data-label="$t('sourceDetail.labelPermisso')"><strong>{{ p.name }}</strong></td>
                  <td :data-label="$t('sourceDetail.labelNvel')">{{ p.level }}</td>
                  <td :data-label="$t('sourceDetail.labelPraQu')">{{ p.why }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-body">
            <p class="hint">{{ $t("sourceDetail.escopoMinimoSomenteLeituraAlem") }} <span class="mono">{{ $t("sourceDetail.push") }}</span> {{ $t("sourceDetail.praDispararAutoDeploy") }}</p>
          </div>
        </div>

        <div v-else class="card">
          <div v-if="resources.length === 0" class="card-body">
            <div class="empty-state">{{ $t("sourceDetail.nenhumaAplicacaoUsaEssaFonte") }}</div>
          </div>
          <div v-else class="rtable-wrap" style="border: none">
            <table class="rtable">
              <thead>
                <tr><th>{{ $t("sourceDetail.aplicacao") }}</th><th>{{ $t("sourceDetail.repositorio") }}</th><th>{{ $t("sourceDetail.projeto") }}</th><th>{{ $t("sourceDetail.ambiente") }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in resources" :key="r.applicationId">
                  <td :data-label="$t('sourceDetail.labelAplicao')">
                    <RouterLink
                      :to="`/teams/${teamId}/projects/${r.projectId}/environments/${r.environmentId}/apps/${r.applicationId}`"
                      class="rtable-name"
                    >
                      <strong>{{ r.applicationName }}</strong>
                    </RouterLink>
                  </td>
                  <td :data-label="$t('sourceDetail.labelRepositrio')" class="mono">{{ r.repo }} ({{ r.branch }})</td>
                  <td :data-label="$t('sourceDetail.labelProjeto')">{{ r.projectName }}</td>
                  <td :data-label="$t('sourceDetail.labelAmbiente')">{{ r.environmentName }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-body">
            <p class="hint">{{ $t("sourceDetail.desconectarAFonteParaO") }}</p>
          </div>
        </div>
      </template>
    </PageState>
  </div>
</template>
