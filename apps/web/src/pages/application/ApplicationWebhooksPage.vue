<script setup lang="ts">
import { computed, ref } from "vue";
import { api, apiBaseUrl, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

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
    error.value = err instanceof ApiError ? err.message : "falha ao gerar o token";
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
    error.value = err instanceof ApiError ? err.message : "falha ao remover o token";
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
        Deploy por URL
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          Um <span class="mono">POST</span> nessa URL dispara um deploy — pra CI (GitHub Actions, GitLab CI), um git hook ou um
          <span class="mono">curl</span> à mão. A URL é a credencial: só o hash dela fica guardado, então ela aparece uma única vez, na hora de gerar.
        </p>
        <div v-if="token" class="callout mb-16">
          <strong>Copie agora — não dá pra ver de novo</strong>
          <pre class="callout-code" style="margin-top: 8px">{{ hookUrl }}</pre>
          <pre class="callout-code">{{ curl }}</pre>
          <button type="button" class="btn btn-secondary btn-sm" @click="copy">
            <span class="material-symbols-outlined" style="font-size: 16px">{{ copied ? "check" : "content_copy" }}</span>
            {{ copied ? "Copiado" : "Copiar URL" }}
          </button>
        </div>
        <p v-else-if="app.hasDeployToken" class="hint mb-16">Já existe um token. Gerar outro invalida o anterior.</p>
        <div class="btn-row">
          <button type="button" class="btn" :disabled="busy" @click="generate">
            <span class="material-symbols-outlined" style="font-size: 18px">key</span>
            {{ app.hasDeployToken ? "Regenerar URL" : "Gerar URL" }}
          </button>
          <button v-if="app.hasDeployToken" type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="busy" @click="remove">
            {{ confirmingRemove ? "Confirmar remoção?" : "Remover URL" }}
          </button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 0">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">hub</span>
        Auto-deploy pelo GitHub
      </div>
      <div class="card-body">
        <p class="hint">
          <template v-if="app.githubRepo">Cada push em <span class="mono">{{ app.branch }}</span> de <span class="mono">{{ app.githubRepo }}</span> já dispara um deploy.</template>
          <template v-else>Só vale pra aplicações criadas a partir de uma fonte GitHub (em Fontes).</template>
          Coloque <span class="mono">[skip ci]</span> ou <span class="mono">[skip cd]</span> na mensagem do commit pra aquele push não fazer deploy.
        </p>
      </div>
    </div>
  </div>
</template>
