<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { ApplicationDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error } = useApplicationContext();

const domainForm = ref("");
const savingDomain = ref(false);
const domainSaved = ref(false);

const limitsForm = ref<{ memoryLimitMb: number | null; cpuLimit: number | null }>({ memoryLimitMb: null, cpuLimit: null });
const savingLimits = ref(false);
const limitsSaved = ref(false);

watchEffect(() => {
  if (!app.value) return;
  domainForm.value = app.value.domain ?? "";
  limitsForm.value = { memoryLimitMb: app.value.memoryLimitMb, cpuLimit: app.value.cpuLimit };
});

async function saveDomain() {
  savingDomain.value = true;
  domainSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ application: ApplicationDto }>(`${basePath}/domain`, { domain: domainForm.value });
    app.value = res.application;
    domainSaved.value = true;
    setTimeout(() => (domainSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar domínio";
  } finally {
    savingDomain.value = false;
  }
}

async function saveLimits() {
  savingLimits.value = true;
  limitsSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ application: ApplicationDto }>(`${basePath}/limits`, {
      memoryLimitMb: limitsForm.value.memoryLimitMb || null,
      cpuLimit: limitsForm.value.cpuLimit || null,
    });
    app.value = res.application;
    limitsSaved.value = true;
    setTimeout(() => (limitsSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar limites";
  } finally {
    savingLimits.value = false;
  }
}
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Repositório</div>
          <div class="mono">{{ app.repoUrl }}</div>
        </div>
        <div>
          <div class="stat-label">Branch</div>
          <div class="mono">{{ app.branch }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ app.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ app.port }}</div>
        </div>
        <div>
          <div class="stat-label">Build pack</div>
          <div class="mono">{{ app.buildPack }}</div>
        </div>
      </div>
    </div>
    <div class="card-header" style="border-top: 1px solid var(--border)">
      <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
      Domínio
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Deixe em branco pra usar o domínio wildcard do servidor (se o proxy estiver ativo) ou publicar a porta direto no host.
      </p>
      <div class="form-group">
        <label for="app-domain">Domínio customizado</label>
        <input id="app-domain" v-model="domainForm" class="form-control mono" placeholder="minhaapp.exemplo.com" />
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingDomain" @click="saveDomain">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingDomain ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="domainSaved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
      </div>
    </div>
    <div class="card-header" style="border-top: 1px solid var(--border)">
      <span class="material-symbols-outlined" style="font-size: 18px">speed</span>
      Limites de recurso
    </div>
    <div class="card-body">
      <p class="hint mb-16">Deixe em branco pra não limitar. Aplica no próximo deploy.</p>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="app-limit-mem">Memória (MB)</label>
          <input id="app-limit-mem" v-model.number="limitsForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="app-limit-cpu">CPU (cores)</label>
          <input id="app-limit-cpu" v-model.number="limitsForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingLimits" @click="saveLimits">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingLimits ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="limitsSaved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
      </div>
    </div>
  </div>
</template>
