<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api, ApiError } from "../lib/api";
import { isDark, toggleTheme } from "../lib/theme";
import { useAuthStore } from "../stores/auth";

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
    twoFaError.value = err instanceof ApiError ? err.message : "falha ao iniciar";
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
    twoFaError.value = err instanceof ApiError ? err.message : "falha ao ativar";
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
    twoFaError.value = err instanceof ApiError ? err.message : "falha ao desativar";
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
        <h1>Configurações</h1>
        <p>Preferências desta instância e da sua conta.</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">palette</span>
        Aparência
      </div>
      <div class="card-body">
        <div class="btn-row" style="align-items: center; justify-content: space-between">
          <div>
            <strong>Tema</strong>
            <p class="hint" style="margin: 2px 0 0">Escuro é o padrão; a escolha fica salva neste navegador.</p>
          </div>
          <button type="button" class="btn btn-secondary" @click="toggleTheme">
            <span class="material-symbols-outlined" style="font-size: 18px">{{ isDark ? "dark_mode" : "light_mode" }}</span>
            {{ isDark ? "Escuro" : "Claro" }}
          </button>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">deployed_code_update</span>
        Versão da plataforma
      </div>
      <div class="card-body">
        <dl class="kv-list">
          <div><dt>Commit atual</dt><dd class="mono">{{ platform?.currentCommit?.slice(0, 7) ?? "-" }}</dd></div>
          <div><dt>Última no GitHub</dt><dd class="mono">{{ platform?.latestCommit?.slice(0, 7) ?? "-" }}</dd></div>
        </dl>
        <div v-if="teamId" class="btn-row" style="margin-top: 16px">
          <RouterLink :to="`/teams/${teamId}/updates`" class="btn btn-secondary">
            <span class="material-symbols-outlined" style="font-size: 18px">arrow_forward</span>
            Ir pra Atualizações
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">person</span>
        Conta
      </div>
      <div class="card-body">
        <dl class="kv-list">
          <div><dt>Nome</dt><dd>{{ auth.user?.name || "-" }}</dd></div>
          <div><dt>E-mail</dt><dd>{{ auth.user?.email }}</dd></div>
        </dl>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
        Verificação em duas etapas
      </div>
      <div class="card-body">
        <div v-if="twoFaError" class="alert alert-error">{{ twoFaError }}</div>
        <div v-if="recoveryCodes.length">
          <p class="hint">Guarde estes códigos de recuperação num lugar seguro — cada um vale uma vez e não serão mostrados de novo:</p>
          <pre class="mono">{{ recoveryCodes.join(' ') }}</pre>
        </div>
        <template v-if="auth.user?.totpEnabled">
          <p>Ativa. O login pede o código do app autenticador.</p>
          <div class="form-group">
            <label for="tf-pass">Senha</label>
            <input id="tf-pass" v-model="twoFaPassword" type="password" class="form-control" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label for="tf-code-off">Código atual (ou de recuperação)</label>
            <input id="tf-code-off" v-model="twoFaCode" class="form-control" autocomplete="one-time-code" />
          </div>
          <button type="button" class="btn btn-secondary" @click="disableTwoFa">Desativar</button>
        </template>
        <template v-else-if="twoFa">
          <p class="hint">Adicione no app autenticador (Google Authenticator, Authy, 1Password...) usando a chave abaixo ou a URI otpauth, e digite o código gerado.</p>
          <p>Chave: <code class="mono">{{ twoFa.secret }}</code></p>
          <p class="hint mono" style="word-break: break-all">{{ twoFa.otpauthUri }}</p>
          <div class="form-group">
            <label for="tf-code-on">Código de 6 dígitos</label>
            <input id="tf-code-on" v-model="twoFaCode" class="form-control" inputmode="numeric" autocomplete="one-time-code" />
          </div>
          <button type="button" class="btn" @click="enableTwoFa">Ativar</button>
        </template>
        <button v-else type="button" class="btn" @click="startTwoFa">Configurar</button>
      </div>
    </div>
  </div>
</template>
