<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";
import { i18n } from "../../lib/i18n";

const { server, teamId, error, replaceServer } = useServerContext();

const form = ref({ wildcardDomain: server.value?.wildcardDomain ?? "", acmeEmail: server.value?.acmeEmail ?? "" });
const saving = ref(false);
const activating = ref(false);
const restarting = ref(false);
const logs = ref("");
const logsMessage = ref("");
const containerRunning = ref<boolean | null>(null);
const loadingLogs = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;

const cfToken = ref("");
const cfSaving = ref(false);
const cfRemoving = ref(false);

async function saveCloudflareTunnel() {
  if (!server.value || !cfToken.value.trim()) return;
  cfSaving.value = true;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/cloudflare-tunnel`, { token: cfToken.value.trim() });
    replaceServer(res.server);
    cfToken.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedSaveToken");
  } finally {
    cfSaving.value = false;
  }
}

async function removeCloudflareTunnel() {
  if (!server.value) return;
  cfRemoving.value = true;
  error.value = "";
  try {
    const res = await api.delete<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/cloudflare-tunnel`);
    replaceServer(res.server);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedRemoveTunnel");
  } finally {
    cfRemoving.value = false;
  }
}

const savingTrafficAnalytics = ref(false);

async function toggleTrafficAnalytics(enabled: boolean) {
  if (!server.value) return;
  savingTrafficAnalytics.value = true;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/traffic-analytics`, { enabled });
    replaceServer(res.server);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedToSave");
    if (server.value) server.value.trafficAnalyticsEnabled = !enabled;
  } finally {
    savingTrafficAnalytics.value = false;
  }
}

const errorPageEnabled = ref(false);
const errorPageTitle = ref("");
const errorPageMessage = ref("");
const savingErrorPage = ref(false);
const errorPageSaved = ref(false);

watchEffect(() => {
  errorPageEnabled.value = server.value?.errorPageEnabled ?? false;
  errorPageTitle.value = server.value?.errorPageTitle ?? "";
  errorPageMessage.value = server.value?.errorPageMessage ?? "";
});

async function saveErrorPage() {
  if (!server.value) return;
  savingErrorPage.value = true;
  errorPageSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/error-page`, { enabled: errorPageEnabled.value, title: errorPageTitle.value, message: errorPageMessage.value });
    replaceServer(res.server);
    errorPageSaved.value = true;
    setTimeout(() => (errorPageSaved.value = false), 3000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedToSave");
  } finally {
    savingErrorPage.value = false;
  }
}

async function save() {
  if (!server.value) return;
  saving.value = true;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/domain`, form.value);
    replaceServer(res.server);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedSaveDomain");
  } finally {
    saving.value = false;
  }
}

async function activate() {
  if (!server.value) return;
  activating.value = true;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/proxy`);
    server.value.proxyStatus = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedEnableProxy");
  } finally {
    activating.value = false;
  }
}

async function restart() {
  if (!server.value) return;
  restarting.value = true;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/proxy/restart`);
    server.value.proxyStatus = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedRestartProxy");
  } finally {
    restarting.value = false;
  }
}

async function loadLogs() {
  if (!server.value) return;
  loadingLogs.value = true;
  try {
    const res = await api.get<{ logs: string; running: boolean; message?: string }>(`/teams/${teamId}/servers/${server.value.id}/proxy/logs?tail=300`);
    logs.value = res.logs;
    logsMessage.value = res.message ?? "";
    containerRunning.value = res.running;
  } catch (err) {
    logsMessage.value = err instanceof ApiError ? err.message : i18n.global.t("serverProxy.failedLoadLogs");
    containerRunning.value = null;
  } finally {
    loadingLogs.value = false;
  }
}

onMounted(() => {
  void loadLogs();
  poll = setInterval(() => void loadLogs(), 10000);
});
onBeforeUnmount(() => clearInterval(poll));
// A fresh activation/restart is worth checking again right away, without waiting for the next tick.
watch(() => server.value?.proxyStatus, (status, prev) => {
  if (prev === "provisioning" && (status === "active" || status === "error")) void loadLogs();
});
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
      {{ $t("serverProxy.reverseProxy") }}
      <StatusBadge :status="server.proxyStatus" style="margin-left: auto" />
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverProxy.enablesTraefikServerAutomaticHttps") }}
      </p>
      <div v-if="server.proxyStatus === 'active' && containerRunning === false" class="callout mb-16" style="border-left-color: var(--warn); display: flex; gap: 8px; align-items: flex-start">
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--warn)">warning</span>
        <span>{{ $t("serverProxy.thePanelMarksProxyActive") }}</span>
      </div>
      <div v-else-if="server.proxyStatus === 'error'" class="callout mb-16" style="border-left-color: var(--bad); display: flex; gap: 8px; align-items: flex-start">
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">error</span>
        <span>{{ $t("serverProxy.theLastProxyActivationRestart") }}</span>
      </div>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="wildcard">{{ $t("serverProxy.wildcardDomain") }}</label>
          <input id="wildcard" v-model="form.wildcardDomain" class="form-control mono" :placeholder="$t('serverProxy.appsMydomainCom')" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="acme">{{ $t("serverProxy.emailLetSEncrypt") }}</label>
          <input id="acme" v-model="form.acmeEmail" class="form-control" placeholder="you@example.com" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ saving ? $t("serverProxy.saving") : $t("common.save") }}
        </button>
        <button type="button" class="btn" :disabled="activating || server.proxyStatus === 'provisioning'" @click="activate">
          <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
          {{ server.proxyStatus === "active" ? $t("serverProxy.reEnableProxy") : $t("serverProxy.enableProxy") }}
        </button>
        <button
          v-if="server.proxyStatus === 'active' || server.proxyStatus === 'error'"
          type="button"
          class="btn btn-secondary"
          :disabled="restarting"
          @click="restart"
        >
          <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
          {{ restarting ? $t("serverProxy.restarting") : $t("common.restart") }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">cloud</span>
      {{ $t("serverProxy.cloudflareTunnel") }}
      <StatusBadge :status="server.cloudflareTunnelStatus" style="margin-left: auto" />
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverProxy.anAlternativeComplementDomainLet") }}
        <span class="mono">{{ $t("serverProxy.httpYeahProxy80") }}</span>{{ $t("serverProxy.andPasteTokenBelowOnly") }}
        <span class="mono">{{ $t("serverProxy.docsInstallationMd") }}</span> {{ $t("serverProxy.panelCloudflareTunnelTailscale") }}
      </p>
      <div v-if="server.cloudflareTunnelStatus === 'error' && server.cloudflareTunnelError" class="callout mb-16" style="border-left-color: var(--bad); display: flex; gap: 8px; align-items: flex-start">
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">error</span>
        <span>{{ server.cloudflareTunnelError }}</span>
      </div>
      <div v-if="server.cloudflareTunnelConfigured" class="btn-row">
        <span class="hint" style="align-self: center">{{ $t("serverProxy.tokenConfigured") }}</span>
        <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="cfRemoving" @click="removeCloudflareTunnel">
          <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
          {{ cfRemoving ? $t("serverProxy.removing") : $t("serverProxy.removeTunnel") }}
        </button>
      </div>
      <form v-else class="form-row" @submit.prevent="saveCloudflareTunnel">
        <div class="form-group" style="margin-bottom: 0; flex: 1">
          <label for="cf-token">{{ $t("serverProxy.tunnelToken") }}</label>
          <input id="cf-token" v-model="cfToken" type="password" class="form-control mono" :placeholder="$t('serverProxy.pastedCloudflareDashboard')" />
        </div>
        <button type="submit" class="btn" style="align-self: flex-end" :disabled="cfSaving || !cfToken.trim()">
          <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
          {{ cfSaving ? $t("serverProxy.enabling") : $t("serverProxy.enableTunnel") }}
        </button>
      </form>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">insights</span>
      {{ $t("serverProxy.trafficAnalytics") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverProxy.requestsPerApplicationReadStraight") }}
      </p>
      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 0">
        <input id="traffic-analytics" type="checkbox" :checked="server.trafficAnalyticsEnabled" :disabled="savingTrafficAnalytics" @change="toggleTrafficAnalytics(($event.target as HTMLInputElement).checked)" />
        <label for="traffic-analytics" style="margin: 0">{{ $t("serverProxy.collectTrafficAnalytics") }}</label>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">error</span>
      {{ $t("serverProxy.errorPage") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("serverProxy.errorPageHint") }}</p>
      <div class="form-group" style="display: flex; align-items: center; gap: 8px">
        <input id="error-page-enabled" v-model="errorPageEnabled" type="checkbox" />
        <label for="error-page-enabled" style="margin: 0">{{ $t("serverProxy.errorPageEnable") }}</label>
      </div>
      <template v-if="errorPageEnabled">
        <div class="form-group">
          <label for="error-page-title">{{ $t("serverProxy.errorPageTitleLabel") }}</label>
          <input id="error-page-title" v-model="errorPageTitle" class="form-control" maxlength="120" :placeholder="$t('serverProxy.errorPageTitlePlaceholder')" />
        </div>
        <div class="form-group">
          <label for="error-page-message">{{ $t("serverProxy.errorPageMessageLabel") }}</label>
          <input id="error-page-message" v-model="errorPageMessage" class="form-control" maxlength="500" :placeholder="$t('serverProxy.errorPageMessagePlaceholder')" />
        </div>
      </template>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingErrorPage" @click="saveErrorPage">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingErrorPage ? $t("serverProxy.saving") : $t("common.save") }}
        </button>
        <span v-if="errorPageSaved" class="muted" style="align-self: center; font-size: 13px">{{ $t("serverProxy.errorPageSaved") }}</span>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      {{ $t("serverProxy.traefikLogs") }}
      <button type="button" class="btn btn-secondary btn-sm" style="margin-left: auto" :disabled="loadingLogs" @click="loadLogs">
        <span class="material-symbols-outlined" style="font-size: 16px">refresh</span>
        {{ $t("serverProxy.refresh") }}
      </button>
    </div>
    <div class="card-body">
      <p v-if="logsMessage" class="hint" style="margin: 0 0 8px">{{ logsMessage }}</p>
      <pre v-if="logs" class="callout-code" style="max-height: 360px; overflow: auto; margin: 0">{{ logs }}</pre>
      <p v-else-if="!logsMessage && !loadingLogs" class="hint" style="margin: 0">{{ $t("serverProxy.noLogYet") }}</p>
    </div>
  </div>
</template>
