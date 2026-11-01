<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ basePath: string; publicAccess: boolean; ssl: boolean }>();
const emit = defineEmits<{ error: [string] }>();

interface Endpoint {
  host: string;
  port: number;
  url: string;
}
interface Connection {
  username: string | null;
  password: string;
  internal: Endpoint;
  external: Endpoint | null;
  /** SQLite: no host, port or password — `internal.url` is the file's URL and `mountPath` where the volume is mounted. */
  fileBased?: boolean;
  mountPath?: string;
}

const data = ref<Connection | null>(null);
const reveal = ref(false);
const copied = ref("");

async function load() {
  try {
    data.value = await api.get<Connection>(`${props.basePath}/connection`);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("databaseConnectionCard.failedReadConnection"));
  }
}
onMounted(load);
// The endpoints change when public access or TLS is switched.
watch(() => [props.publicAccess, props.ssl], load);

const mask = (url: string, password: string) => (reveal.value ? url : url.split(encodeURIComponent(password)).join("••••••••"));

async function copy(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => (copied.value = ""), 1500);
  } catch {
    copied.value = "";
  }
}
</script>

<template>
  <div v-if="data && data.fileBased" class="card-body" style="border-top: 1px solid var(--border)">
    <strong>{{ $t("databaseConnectionCard.fileConnection") }}</strong>
    <div class="stat-label" style="margin-top: 8px">{{ $t("databaseConnectionCard.fileUrl") }}</div>
    <div class="conn-row">
      <code class="callout-code" style="margin: 0; flex: 1">{{ data.internal.url }}</code>
      <button type="button" class="btn btn-secondary btn-sm" @click="copy('internal', data.internal.url)">{{ copied === "internal" ? $t('common.copied') : $t('common.copy') }}</button>
    </div>
    <p class="hint" style="margin: 6px 0 0">{{ $t("databaseConnectionCard.fileHint", { p0: data.mountPath }) }}</p>
  </div>
  <div v-else-if="data" class="card-body" style="border-top: 1px solid var(--border)">
    <div class="btn-row" style="justify-content: space-between; margin-bottom: 8px">
      <strong>{{ $t("databaseConnectionCard.connection") }}</strong>
      <button type="button" class="btn btn-secondary btn-sm" @click="reveal = !reveal">
        <span class="material-symbols-outlined" style="font-size: 16px">{{ reveal ? "visibility_off" : "visibility" }}</span>
        {{ reveal ? $t("databaseConnectionCard.hidePassword") : $t("databaseConnectionCard.showPassword") }}
      </button>
    </div>

    <div class="stat-label">{{ $t("databaseConnectionCard.internalOtherResourcesEnvironment") }}</div>
    <div class="conn-row">
      <code class="callout-code" style="margin: 0; flex: 1">{{ mask(data.internal.url, data.password) }}</code>
      <button type="button" class="btn btn-secondary btn-sm" @click="copy('internal', data.internal.url)">{{ copied === "internal" ? $t('common.copied') : $t('common.copy') }}</button>
    </div>

    <div class="stat-label" style="margin-top: 12px">{{ $t("databaseConnectionCard.externalOutsideServer") }}</div>
    <div v-if="data.external" class="conn-row">
      <code class="callout-code" style="margin: 0; flex: 1">{{ mask(data.external.url, data.password) }}</code>
      <button type="button" class="btn btn-secondary btn-sm" @click="copy('external', data.external.url)">{{ copied === "external" ? $t('common.copied') : $t('common.copy') }}</button>
    </div>
    <p v-else class="hint" style="margin: 0">{{ $t("databaseConnectionCard.externalAccessOffDatabaseOnly") }}</p>
    <p v-if="data.external" class="hint" style="margin-top: 6px">
      {{ $t("databaseConnectionCard.port") }} <span class="mono">{{ data.external.port }}</span> {{ $t("databaseConnectionCard.isOpenInternetProtectedOnly", { p0: ssl ? " " + $t('databaseConnectionCard.sslNote') : ". " + $t('databaseConnectionCard.sslAdvice') }) }}
    </p>
  </div>
</template>
