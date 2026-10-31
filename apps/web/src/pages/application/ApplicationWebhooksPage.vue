<script setup lang="ts">
import { computed, ref } from "vue";
import { api, apiBaseUrl, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

const { app, basePath, error } = useApplicationContext();

const token = ref("");
const busy = ref(false);
const copied = ref(false);
const confirmingRemove = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const hookUrl = computed(() => (token.value ? `${apiBaseUrl()}/hooks/deploy/${token.value}` : ""));
const curl = computed(() => (hookUrl.value ? `curl -X POST "${hookUrl.value}"` : ""));

async function generate() {
  busy.value = true;
  error.value = "";
  copied.value = false;
  try {
    const res = await api.post<{ token: string }>(`${basePath}/deploy-token`);
    token.value = res.token;
    if (app.value) app.value.hasDeployToken = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationWebhooks.failedGenerateToken");
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirmingRemove.value) {
    confirmingRemove.value = true;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingRemove.value = false), 3000);
    return;
  }
  busy.value = true;
  try {
    await api.delete(`${basePath}/deploy-token`);
    token.value = "";
    if (app.value) app.value.hasDeployToken = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationWebhooks.failedRemoveToken");
  } finally {
    confirmingRemove.value = false;
    busy.value = false;
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(hookUrl.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div v-if="app">
    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">webhook</span>
        {{ $t("applicationWebhooks.deployByUrl") }}
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          {{ $t("applicationWebhooks.a") }} <span class="mono">{{ $t("applicationWebhooks.post") }}</span> {{ $t("applicationWebhooks.toUrlTriggersDeployCi") }}
          <span class="mono">{{ $t("applicationWebhooks.curl") }}</span> {{ $t("applicationWebhooks.byHandUrlCredentialOnly") }}
        </p>
        <div v-if="token" class="callout mb-16">
          <strong>{{ $t("applicationWebhooks.copyNowCanTViewed") }}</strong>
          <pre class="callout-code" style="margin-top: 8px">{{ hookUrl }}</pre>
          <pre class="callout-code">{{ curl }}</pre>
          <button type="button" class="btn btn-secondary btn-sm" @click="copy">
            <span class="material-symbols-outlined" style="font-size: 16px">{{ copied ? "check" : "content_copy" }}</span>
            {{ copied ? $t('common.copied') : $t("applicationWebhooks.copyUrl") }}
          </button>
        </div>
        <p v-else-if="app.hasDeployToken" class="hint mb-16">{{ $t("applicationWebhooks.aTokenAlreadyExistsGenerating") }}</p>
        <div class="btn-row">
          <button type="button" class="btn" :disabled="busy" @click="generate">
            <span class="material-symbols-outlined" style="font-size: 18px">key</span>
            {{ app.hasDeployToken ? $t("applicationWebhooks.regenerateUrl") : $t("applicationWebhooks.generateUrl") }}
          </button>
          <button v-if="app.hasDeployToken" type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="busy" @click="remove">
            {{ confirmingRemove ? $t("applicationWebhooks.confirmRemoval") : $t("applicationWebhooks.removeUrl") }}
          </button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 0">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">hub</span>
        {{ $t("applicationWebhooks.autoDeployGithub") }}
      </div>
      <div class="card-body">
        <p class="hint">
          <template v-if="app.githubRepo">{{ $t("applicationWebhooks.everyPushTo") }} <span class="mono">{{ app.branch }}</span> {{ $t("applicationWebhooks.of") }} <span class="mono">{{ app.githubRepo }}</span> {{ $t("applicationWebhooks.alreadyTriggersDeploy") }}</template>
          <template v-else>{{ $t("applicationWebhooks.onlyAppliesApplicationsCreatedGithub") }}</template>
          {{ $t("applicationWebhooks.put") }} <span class="mono">{{ $t("applicationWebhooks.skipCi") }}</span> {{ $t("applicationWebhooks.or") }} <span class="mono">{{ $t("applicationWebhooks.skipCd") }}</span> {{ $t("applicationWebhooks.inCommitMessageSoPush") }}
        </p>
      </div>
    </div>
  </div>
</template>
