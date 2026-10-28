<script setup lang="ts">
import { onMounted, ref } from "vue";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
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

interface PasskeyRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
const passkeys = ref<PasskeyRow[]>([]);
const passkeyName = ref("");
const passkeyError = ref("");
const passkeyBusy = ref(false);
const passkeySupported = browserSupportsWebAuthn();

async function loadPasskeys() {
  try {
    passkeys.value = (await api.get<{ passkeys: PasskeyRow[] }>("/auth/passkeys")).passkeys;
  } catch {
    passkeys.value = [];
  }
}

async function addPasskey() {
  passkeyError.value = "";
  passkeyBusy.value = true;
  try {
    const optionsJSON = await api.post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkeys/register/options");
    const response = await startRegistration({ optionsJSON });
    await api.post("/auth/passkeys/register/verify", { name: passkeyName.value || "Passkey", response });
    passkeyName.value = "";
    await loadPasskeys();
  } catch (err) {
    passkeyError.value = err instanceof ApiError ? err.message : i18n.global.t("settings.passkeyFalha");
  } finally {
    passkeyBusy.value = false;
  }
}

async function removePasskey(id: string) {
  if (!confirm(i18n.global.t("settings.passkeyConfirmar"))) return;
  try {
    await api.delete(`/auth/passkeys/${id}`);
    await loadPasskeys();
  } catch (err) {
    passkeyError.value = err instanceof ApiError ? err.message : i18n.global.t("settings.passkeyFalha");
  }
}

onMounted(async () => {
  void loadPasskeys();
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
        <span class="material-symbols-outlined" style="font-size: 18px">passkey</span>
        {{ $t("settings.passkeys") }}
      </div>
      <div class="card-body">
        <p class="hint mb-16">{{ $t("settings.passkeysDica") }}</p>
        <div v-if="passkeyError" class="alert alert-error mb-16">{{ passkeyError }}</div>
        <p v-if="!passkeySupported" class="hint">{{ $t("settings.passkeySemSuporte") }}</p>
        <template v-else>
          <div v-if="passkeys.length" class="table-wrap mb-16">
            <table>
              <thead><tr><th>{{ $t("settings.passkeyNome") }}</th><th>{{ $t("settings.passkeyUltimoUso") }}</th><th></th></tr></thead>
              <tbody>
                <tr v-for="k in passkeys" :key="k.id">
                  <td>{{ k.name }}</td>
                  <td>{{ k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—" }}</td>
                  <td><button type="button" class="btn btn-secondary btn-sm" @click="removePasskey(k.id)">{{ $t("settings.passkeyRemover") }}</button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="form-row">
            <div class="form-group" style="margin-bottom: 0">
              <label for="passkey-name">{{ $t("settings.passkeyNome") }}</label>
              <input id="passkey-name" v-model="passkeyName" class="form-control" :placeholder="$t('settings.passkeyNomeExemplo')" maxlength="100" />
            </div>
            <div class="form-group" style="margin-bottom: 0; align-self: end">
              <button type="button" class="btn btn-secondary" :disabled="passkeyBusy" @click="addPasskey">
                <span class="material-symbols-outlined" style="font-size: 18px">add</span>
                {{ passkeyBusy ? $t("settings.passkeyAguardando") : $t("settings.passkeyAdicionar") }}
              </button>
            </div>
          </div>
        </template>
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
