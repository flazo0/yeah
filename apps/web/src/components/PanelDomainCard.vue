<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ teamId: string }>();

interface PlatformServer {
  id: string;
  name: string;
  host: string;
  proxyActive: boolean;
  hasAcmeEmail: boolean;
}
interface PanelDomainState {
  domain: string | null;
  platformServer: PlatformServer | null;
}
interface DnsCheck {
  domain: string;
  found: string[];
  expected: string[];
  matches: boolean;
}

const state = ref<PanelDomainState | null>(null);
const input = ref("");
const loading = ref(true);
const saving = ref(false);
const checking = ref(false);
const error = ref("");
const saved = ref(false);
const dns = ref<DnsCheck | null>(null);

const base = computed(() => `/teams/${props.teamId}/instance/panel-domain`);
const ready = computed(() => !!state.value?.platformServer?.proxyActive && !!state.value?.platformServer?.hasAcmeEmail);
const changed = computed(() => input.value.trim().toLowerCase() !== (state.value?.domain ?? ""));

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

async function load() {
  loading.value = true;
  try {
    state.value = await api.get<PanelDomainState>(base.value);
    input.value = state.value.domain ?? "";
  } catch (err) {
    error.value = message(err, i18n.global.t("panelDomain.failedToLoad"));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function checkDns() {
  checking.value = true;
  error.value = "";
  dns.value = null;
  try {
    dns.value = await api.post<DnsCheck>(`${base.value}/check`, { domain: input.value });
  } catch (err) {
    error.value = message(err, i18n.global.t("panelDomain.failedToCheck"));
  } finally {
    checking.value = false;
  }
}

async function save(clear = false) {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    state.value = await api.put<PanelDomainState>(base.value, { domain: clear ? null : input.value });
    input.value = state.value.domain ?? "";
    dns.value = null;
    saved.value = true;
    setTimeout(() => (saved.value = false), 4000);
  } catch (err) {
    error.value = message(err, i18n.global.t("panelDomain.failedToSave"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card mb-16">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">public</span>
      {{ $t("panelDomain.title") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("panelDomain.hint") }}</p>
      <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
      <p v-if="loading" class="muted">{{ $t("common.loading") }}</p>
      <template v-else-if="state">
        <div v-if="!state.platformServer" class="alert alert-warning mb-16">{{ $t("panelDomain.noServer") }}</div>
        <div v-else-if="!state.platformServer.proxyActive || !state.platformServer.hasAcmeEmail" class="alert alert-warning mb-16">
          {{ $t("panelDomain.proxyNotReady", { server: state.platformServer.name }) }}
          <RouterLink :to="`/teams/${teamId}/servers/${state.platformServer.id}/proxy`">{{ $t("panelDomain.openProxy") }}</RouterLink>
        </div>

        <p v-if="state.domain" class="mb-16">
          {{ $t("panelDomain.current") }}
          <a :href="`https://${state.domain}`" target="_blank" rel="noopener" class="mono">https://{{ state.domain }}</a>
        </p>

        <div class="form-group">
          <label for="panel-domain">{{ $t("panelDomain.domain") }}</label>
          <input id="panel-domain" v-model="input" type="text" class="form-control mono" placeholder="panel.example.com" autocomplete="off" spellcheck="false" :disabled="!ready" />
        </div>

        <div v-if="dns" class="mb-16" :class="dns.matches ? 'alert alert-success' : 'alert alert-warning'">
          <template v-if="dns.matches">{{ $t("panelDomain.dnsOk", { domain: dns.domain }) }}</template>
          <template v-else-if="dns.found.length === 0">{{ $t("panelDomain.dnsMissing", { domain: dns.domain, expected: dns.expected.join(", ") }) }}</template>
          <template v-else>{{ $t("panelDomain.dnsWrong", { domain: dns.domain, found: dns.found.join(", "), expected: dns.expected.join(", ") }) }}</template>
        </div>

        <div class="btn-row">
          <button type="button" class="btn btn-secondary" :disabled="checking || !input.trim() || !ready" @click="checkDns">
            <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
            {{ checking ? $t("panelDomain.checking") : $t("panelDomain.checkDns") }}
          </button>
          <button type="button" class="btn btn-primary" :disabled="saving || !input.trim() || !changed || !ready" @click="save(false)">
            <span class="material-symbols-outlined" style="font-size: 18px">lock</span>
            {{ saving ? $t("resourceLimitsCard.saving") : $t("panelDomain.saveHttps") }}
          </button>
          <button v-if="state.domain" type="button" class="btn btn-secondary" :disabled="saving" @click="save(true)">{{ $t("panelDomain.remove") }}</button>
          <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("panelDomain.saved") }}</span>
        </div>
        <p class="hint" style="margin-top: 12px">{{ $t("panelDomain.afterSave") }}</p>
      </template>
    </div>
  </div>
</template>
