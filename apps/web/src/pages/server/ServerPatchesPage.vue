<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import { i18n, dateLocale } from "../../lib/i18n";

interface PatchesView {
  updates: number | null;
  security: number | null;
  rebootRequired: boolean;
  checkedAt: string | null;
  autoSecurityUpdates: boolean;
  packages: Array<{ name: string; version: string; security: boolean; risky: boolean }>;
}

const { server, teamId, error } = useServerContext();
const base = () => `/teams/${teamId}/servers/${server.value!.id}/patches`;

const patches = ref<PatchesView | null>(null);
const checking = ref(false);
const applying = ref(false);
const toggling = ref(false);
const message = ref("");

async function load() {
  try {
    patches.value = (await api.get<{ patches: PatchesView }>(base())).patches;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverPatches.failedToLoad");
  }
}

async function check() {
  checking.value = true;
  error.value = "";
  message.value = "";
  try {
    patches.value = (await api.post<{ patches: PatchesView }>(`${base()}/check`, {})).patches;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverPatches.failedCheckUpdates");
  } finally {
    checking.value = false;
  }
}

async function apply(securityOnly: boolean) {
  if (!confirm(i18n.global.t(securityOnly ? "serverPatches.installPendingSecurityUpdatesNow" : "serverPatches.installAllPendingUpdatesNow"))) return;
  applying.value = true;
  error.value = "";
  try {
    await api.post(`${base()}/apply`, { securityOnly });
    message.value = i18n.global.t("serverPatches.iniciado");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverPatches.failedStartUpdate");
  } finally {
    applying.value = false;
  }
}

async function toggleAuto() {
  const next = !patches.value?.autoSecurityUpdates;
  if (!confirm(i18n.global.t(next ? "serverPatches.turnAutomaticSecurityUpdatesServer" : "serverPatches.turnOffAutomaticSecurityUpdates"))) {
    await load();
    return;
  }
  toggling.value = true;
  error.value = "";
  try {
    patches.value = (await api.put<{ patches: PatchesView }>(`${base()}/auto`, { enabled: next })).patches;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverPatches.failedChangeOption");
    await load();
  } finally {
    toggling.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">system_update</span>
      {{ $t("serverPatches.title") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("serverPatches.hint") }}</p>
      <div v-if="patches" class="grid grid-2 mb-16">
        <div>
          <div class="stat-label">{{ $t("serverPatches.pendingUpdates") }}</div>
          <div class="mono">{{ patches.updates ?? "-" }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("serverPatches.security") }}</div>
          <div class="mono">{{ patches.security ?? "-" }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("serverPatches.rebootRequired") }}</div>
          <div>{{ patches.rebootRequired ? $t("serverPatches.yes") : $t("serverPatches.no") }}</div>
        </div>
        <div>
          <div class="stat-label">{{ $t("serverPatches.lastCheck") }}</div>
          <div>{{ patches.checkedAt ? new Date(patches.checkedAt).toLocaleString(dateLocale()) : $t("serverPatches.never") }}</div>
        </div>
      </div>
      <div v-if="message" class="callout mb-16">{{ message }}</div>
      <div class="btn-row mb-16">
        <button type="button" class="btn btn-secondary" :disabled="checking" @click="check">
          <span class="material-symbols-outlined" style="font-size: 18px">refresh</span>
          {{ checking ? $t("serverPatches.checking") : $t("serverPatches.checkNow") }}
        </button>
        <button type="button" class="btn btn-secondary" :disabled="applying || !patches?.security" @click="apply(true)">
          <span class="material-symbols-outlined" style="font-size: 18px">security_update_good</span>
          {{ $t("serverPatches.applySecurityUpdatesOnly") }}
        </button>
        <button type="button" class="btn btn-secondary" :disabled="applying || !patches?.updates" @click="apply(false)">
          <span class="material-symbols-outlined" style="font-size: 18px">download</span>
          {{ $t("serverPatches.applyAll") }}
        </button>
      </div>
      <div class="form-group" style="display: flex; align-items: center; gap: 8px">
        <input id="auto-sec" type="checkbox" :checked="patches?.autoSecurityUpdates" :disabled="toggling" @change="toggleAuto" />
        <label for="auto-sec" style="margin: 0">{{ $t("serverPatches.installSecurityUpdatesAutomaticallyUnattended") }}</label>
      </div>
    </div>
  </div>

  <div v-if="patches?.packages.length" class="card" style="margin-top: 16px">
    <div class="card-header">{{ $t("serverPatches.pendingPackages") }}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>{{ $t("serverPatches.package") }}</th><th>{{ $t("serverPatches.version") }}</th><th>{{ $t("serverPatches.type") }}</th></tr></thead>
        <tbody>
          <tr v-for="p in patches.packages" :key="p.name">
            <td class="mono">{{ p.name }}</td>
            <td class="mono">{{ p.version }}</td>
            <td>
              <span v-if="p.security" class="badge badge-bad">{{ $t("serverPatches.security") }}</span>
              <span v-if="p.risky" class="badge badge-warn" :title="$t('serverPatches.mayRestartServicesServer')">{{ $t("serverPatches.risky") }}</span>
              <span v-if="!p.security && !p.risky" class="muted">{{ $t("serverPatches.regular") }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
