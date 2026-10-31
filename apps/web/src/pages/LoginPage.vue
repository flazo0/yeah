<script setup lang="ts">
import { ref } from "vue";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import { api, ApiError } from "../lib/api";
import Logo from "../components/Logo.vue";

const { t } = useI18n();
const email = ref("");
const password = ref("");
const code = ref("");
const needsCode = ref(false);
const error = ref("");
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    await auth.login(email.value, password.value, code.value || undefined);
    router.push("/dashboard");
  } catch (err) {
    if (err instanceof ApiError && err.code === "totp_required") needsCode.value = true;
    error.value = err instanceof ApiError ? err.message : t("login.failed");
  } finally {
    loading.value = false;
  }
}

const passkeySupported = browserSupportsWebAuthn();

async function signInWithPasskey() {
  error.value = "";
  loading.value = true;
  try {
    const optionsJSON = await api.post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/passkeys/login/options");
    const response = await startAuthentication({ optionsJSON });
    await auth.loginWithPasskey(response);
    router.push("/dashboard");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : t("login.passkeyFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-shell">
    <div class="auth-form-card">
      <div class="auth-logo">
        <Logo :height="44" />
      </div>
      <div class="auth-form-head">
        <h1>{{ t("login.title") }}</h1>
        <p>{{ t("login.subtitle") }}</p>
      </div>
      <form @submit.prevent="submit">
        <div class="form-group">
          <label for="email">{{ t("login.email") }}</label>
          <div class="input-icon">
            <span class="material-symbols-outlined">mail</span>
            <input
              id="email"
              v-model="email"
              type="email"
              class="form-control form-control-lg"
              placeholder="seu@email.com"
              required
              autocomplete="email"
              autofocus
            />
          </div>
        </div>
        <div class="form-group">
          <label for="password">{{ t("login.password") }}</label>
          <div class="input-icon">
            <span class="material-symbols-outlined">lock</span>
            <input
              id="password"
              v-model="password"
              type="password"
              class="form-control form-control-lg"
              :placeholder="t('login.passwordPlaceholder')"
              required
              autocomplete="current-password"
            />
          </div>
        </div>
        <div v-if="needsCode" class="form-group">
          <label for="totp-code">{{ t("login.code") }}</label>
          <input id="totp-code" v-model="code" class="form-control form-control-lg" :placeholder="t('login.codePlaceholder')" autocomplete="one-time-code" autofocus />
        </div>
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        <button type="submit" class="btn btn-lg btn-block" :disabled="loading">
          {{ loading ? t("login.submitting") : t("login.submit") }}
        </button>
        <button v-if="passkeySupported" type="button" class="btn btn-secondary btn-lg btn-block" style="margin-top: 8px" :disabled="loading" @click="signInWithPasskey">
          {{ t("login.passkey") }}
        </button>
      </form>
    </div>
  </div>
</template>
