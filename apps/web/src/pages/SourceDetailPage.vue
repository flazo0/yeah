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
  { key: "permissions", label: i18n.global.t("sourceDetail.permissions"), icon: "lock" },
  { key: "resources", label: i18n.global.t("common.resources"), icon: "deployed_code" },
] as const;
const tab = computed(() => tabs.find((t) => t.key === route.query.tab)?.key ?? "general");

const permissions = [
  { name: "Contents", level: "Read", why: i18n.global.t("sourceDetail.cloneRepositoryDownloadCodeDeploy") },
  { name: "Metadata", level: "Read", why: i18n.global.t("sourceDetail.listRepositoriesAppCanSee") },
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sourceDetail.failedLoadSource");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("sourceDetail.failedToDisconnect");
    disconnecting.value = false;
    confirmingDisconnect.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/sources`" class="breadcrumb-item">{{ $t("sourceDetail.sources") }}</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">{{ installation?.accountLogin ?? "…" }}</span>
    </nav>

    <PageState :loading="loading" :error="error" :empty="!installation" empty-icon="hub" :empty-text="$t('sourceDetail.sourceNotFound')">
      <template v-if="installation">
        <div class="resource-header">
          <div class="resource-title">
            <span class="material-symbols-outlined">hub</span>
            {{ installation.accountLogin }}
            <StatusBadge status="connected" />
          </div>
          <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="disconnecting" @click="disconnect">
            <span class="material-symbols-outlined" style="font-size: 18px">link_off</span>
            {{ confirmingDisconnect ? $t("sourceDetail.confirmDisconnect") : $t("common.disconnect") }}
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
              <div><dt>{{ $t("sourceDetail.account") }}</dt><dd class="mono">{{ installation.accountLogin }}</dd></div>
              <div><dt>{{ $t("sourceDetail.type") }}</dt><dd>{{ installation.accountType }}</dd></div>
              <div><dt>{{ $t("sourceDetail.installationId") }}</dt><dd class="mono">{{ installation.installationId }}</dd></div>
              <div><dt>{{ $t("sourceDetail.connectedOn") }}</dt><dd>{{ new Date(installation.createdAt).toLocaleString(dateLocale()) }}</dd></div>
            </dl>
            <p class="hint" style="margin-top: 16px">
              {{ $t("sourceDetail.theAppPrivateKeyWebhook") }}
              <span class="mono">{{ $t("sourceDetail.envExample") }}</span>.
            </p>
          </div>
        </div>

        <div v-else-if="tab === 'permissions'" class="card">
          <div class="rtable-wrap" style="border: none">
            <table class="rtable">
              <thead>
                <tr><th>{{ $t("sourceDetail.permission") }}</th><th>{{ $t("sourceDetail.level") }}</th><th>{{ $t("sourceDetail.whatFor") }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in permissions" :key="p.name">
                  <td :data-label="$t('sourceDetail.labelPermisso')"><strong>{{ p.name }}</strong></td>
                  <td :data-label="$t('sourceDetail.labelNvel')">{{ p.level }}</td>
                  <td :data-label="$t('sourceDetail.whatFor2')">{{ p.why }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-body">
            <p class="hint">{{ $t("sourceDetail.minimalScopeReadOnlyApp") }} <span class="mono">{{ $t("sourceDetail.push") }}</span> {{ $t("sourceDetail.eventTriggerAutoDeploy") }}</p>
          </div>
        </div>

        <div v-else class="card">
          <div v-if="resources.length === 0" class="card-body">
            <div class="empty-state">{{ $t("sourceDetail.noApplicationUsesSourceYet") }}</div>
          </div>
          <div v-else class="rtable-wrap" style="border: none">
            <table class="rtable">
              <thead>
                <tr><th>{{ $t("sourceDetail.application") }}</th><th>{{ $t("sourceDetail.repository") }}</th><th>{{ $t("sourceDetail.project") }}</th><th>{{ $t("sourceDetail.environment") }}</th></tr>
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
                  <td :data-label="$t('sourceDetail.project2')">{{ r.projectName }}</td>
                  <td :data-label="$t('sourceDetail.environment2')">{{ r.environmentName }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-body">
            <p class="hint">{{ $t("sourceDetail.disconnectingSourceStopsAutoDeploy") }}</p>
          </div>
        </div>
      </template>
    </PageState>
  </div>
</template>
