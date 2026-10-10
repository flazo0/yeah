<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { api, ApiError } from "../lib/api";
import { LOCALES, setLocale, type Locale } from "../lib/i18n";
import { isDark, toggleTheme } from "../lib/theme";
import { useAuthStore } from "../stores/auth";
import { i18n } from "../lib/i18n";

const { t, locale } = useI18n();
const route = useRoute();
const auth = useAuthStore();
const teamId = (route.params.teamId as string | undefined) ?? auth.teams[0]?.id;

interface PlatformInfo {
  currentCommit?: string | null;
  latestCommit?: string | null;
  updateAvailable?: boolean;
}
const platform = ref<PlatformInfo | null>(null);

const twoFa = ref<{ secret: string; otpauthUri: string } | null>(null);
const twoFaCode = ref("");
const twoFaPassword = ref("");
const recoveryCodes = ref<string[]>([]);
const twoFaError = ref("");

async function startTwoFa() {
  twoFaError.value = "";
  try {
    twoFa.value = await api.post<{ secret: string; otpauthUri: string }>("/auth/2fa/setup");
  } catch (err) {
    twoFaError.value = err instanceof ApiError ? err.message : i18n.global.t("settings.falhaAoIniciar");
  }
}

async function enableTwoFa() {
  twoFaError.value = "";
  try {
    recoveryCodes.value = (await api.post<{ recoveryCodes: string[] }>("/auth/2fa/enable", { code: twoFaCode.value })).recoveryCodes;
    twoFa.value = null;
    twoFaCode.value = "";
    await auth.fetchMe();
  } catch (err) {
    twoFaError.value = err instanceof ApiError ? err.message : i18n.global.t("settings.falhaAoAtivar");
  }
}

async function disableTwoFa() {
  twoFaError.value = "";
  try {
    await api.post("/auth/2fa/disable", { password: twoFaPassword.value, code: twoFaCode.value });
    twoFaCode.value = "";
    twoFaPassword.value = "";
    await auth.fetchMe();
  } catch (err) {
    twoFaError.value = err instanceof ApiError ? err.message : i18n.global.t("settings.falhaAoDesativar");
  }
}

onMounted(async () => {
  try {
    platform.value = await api.get<PlatformInfo>("/updates/platform");
  } catch {
    platform.value = null;
  }
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ t("settings.title") }}</h1>
        <p>{{ t("settings.subtitle") }}</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">palette</span>
        {{ $t("settings.aparencia") }}
      </div>
      <div class="card-body">
        <div class="btn-row" style="align-items: center; justify-content: space-between">
          <div>
            <strong>{{ $t("settings.tema") }}</strong>
            <p class="hint" style="margin: 2px 0 0">{{ $t("settings.escuroEOPadraoA") }}</p>
          </div>
          <button type="button" class="btn btn-secondary" @click="toggleTheme">
            <span class="material-symbols-outlined" style="font-size: 18px">{{ isDark ? "dark_mode" : "light_mode" }}</span>
            {{ isDark ? $t('common.dark') : $t('common.light') }}
          </button>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">deployed_code_update</span>
        {{ $t("settings.versaoDaPlataforma") }}
      </div>
      <div class="card-body">
        <dl class="kv-list">
          <div><dt>{{ $t("settings.commitAtual") }}</dt><dd class="mono">{{ platform?.currentCommit?.slice(0, 7) ?? "-" }}</dd></div>
          <div><dt>{{ $t("settings.ultimaNoGithub") }}</dt><dd class="mono">{{ platform?.latestCommit?.slice(0, 7) ?? "-" }}</dd></div>
        </dl>
        <div v-if="teamId" class="btn-row" style="margin-top: 16px">
          <RouterLink :to="`/teams/${teamId}/updates`" class="btn btn-secondary">
            <span class="material-symbols-outlined" style="font-size: 18px">arrow_forward</span>
            {{ $t("settings.irPraAtualizacoes") }}
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">person</span>
        {{ $t("settings.conta") }}
      </div>
      <div class="card-body">
        <dl class="kv-list">
          <div><dt>{{ $t("settings.nome") }}</dt><dd>{{ auth.user?.name || "-" }}</dd></div>
          <div><dt>{{ $t("settings.eMail") }}</dt><dd>{{ auth.user?.email }}</dd></div>
        </dl>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">translate</span>
        {{ t("settings.language") }}
      </div>
      <div class="card-body">
        <label for="locale-select" class="hint">{{ t("settings.language") }}</label>
        <select id="locale-select" class="form-control" :value="locale" @change="setLocale(($event.target as HTMLSelectElement).value as Locale)">
          <option v-for="loc in LOCALES" :key="loc" :value="loc">{{ loc === "pt" ? $t("settings.portugues") : "English" }}</option>
        </select>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
        {{ $t("settings.verificacaoEmDuasEtapas") }}
      </div>
      <div class="card-body">
        <div v-if="twoFaError" class="alert alert-error">{{ twoFaError }}</div>
        <div v-if="recoveryCodes.length">
          <p class="hint">{{ $t("settings.guardeEstesCodigosDeRecuperacao") }}</p>
          <pre class="mono">{{ recoveryCodes.join(' ') }}</pre>
        </div>
        <template v-if="auth.user?.totpEnabled">
          <p>{{ $t("settings.ativaOLoginPedeO") }}</p>
          <div class="form-group">
            <label for="tf-pass">{{ $t("settings.senha") }}</label>
            <input id="tf-pass" v-model="twoFaPassword" type="password" class="form-control" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label for="tf-code-off">{{ $t("settings.codigoAtualOuDeRecuperacao") }}</label>
            <input id="tf-code-off" v-model="twoFaCode" class="form-control" autocomplete="one-time-code" />
          </div>
          <button type="button" class="btn btn-secondary" @click="disableTwoFa">{{ $t("settings.desativar") }}</button>
        </template>
        <template v-else-if="twoFa">
          <p class="hint">{{ $t("settings.adicioneNoAppAutenticadorGoogle") }}</p>
          <p>{{ $t("settings.chave") }} <code class="mono">{{ twoFa.secret }}</code></p>
          <p class="hint mono" style="word-break: break-all">{{ twoFa.otpauthUri }}</p>
          <div class="form-group">
            <label for="tf-code-on">{{ $t("settings.codigoDe6Digitos") }}</label>
            <input id="tf-code-on" v-model="twoFaCode" class="form-control" inputmode="numeric" autocomplete="one-time-code" />
          </div>
          <button type="button" class="btn" @click="enableTwoFa">{{ $t("settings.ativar") }}</button>
        </template>
        <button v-else type="button" class="btn" @click="startTwoFa">{{ $t("settings.configurar") }}</button>
      </div>
    </div>
  </div>
</template>
