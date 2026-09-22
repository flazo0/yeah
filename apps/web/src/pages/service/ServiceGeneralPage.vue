<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { ServiceDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServiceContext } from "../../composables/useServiceContext";

const { service, basePath, error } = useServiceContext();

const domainForm = ref("");
const savingDomain = ref(false);
const domainSaved = ref(false);

const limitsForm = ref<{ memoryLimitMb: number | null; cpuLimit: number | null }>({ memoryLimitMb: null, cpuLimit: null });
const savingLimits = ref(false);
const limitsSaved = ref(false);

watchEffect(() => {
  if (!service.value) return;
  domainForm.value = service.value.domain ?? "";
  limitsForm.value = { memoryLimitMb: service.value.memoryLimitMb, cpuLimit: service.value.cpuLimit };
});

async function saveDomain() {
  savingDomain.value = true;
  domainSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ service: ServiceDto }>(`${basePath}/domain`, { domain: domainForm.value });
    service.value = res.service;
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
    const res = await api.put<{ service: ServiceDto }>(`${basePath}/limits`, {
      memoryLimitMb: limitsForm.value.memoryLimitMb || null,
      cpuLimit: limitsForm.value.cpuLimit || null,
    });
    service.value = res.service;
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
  <div v-if="service" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Catálogo</div>
          <div class="mono">{{ service.catalogKey }}</div>
        </div>
        <div>
          <div class="stat-label">Imagem</div>
          <div class="mono">{{ service.image }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ service.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ service.port }}</div>
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
        <label for="svc-domain">Domínio customizado</label>
        <input id="svc-domain" v-model="domainForm" class="form-control mono" placeholder="minhaapp.exemplo.com" />
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingDomain" @click="saveDomain">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingDomain ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="domainSaved" class="muted" style="align-self: center; font-size: 13px">salvo — reimplante pra aplicar</span>
      </div>
    </div>
    <div class="card-header" style="border-top: 1px solid var(--border)">
      <span class="material-symbols-outlined" style="font-size: 18px">speed</span>
      Limites de recurso
    </div>
    <div class="card-body">
      <p class="hint mb-16">Deixe em branco pra não limitar. Reimplante pra aplicar.</p>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="svc-limit-mem">Memória (MB)</label>
          <input id="svc-limit-mem" v-model.number="limitsForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="svc-limit-cpu">CPU (cores)</label>
          <input id="svc-limit-cpu" v-model.number="limitsForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingLimits" @click="saveLimits">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingLimits ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="limitsSaved" class="muted" style="align-self: center; font-size: 13px">salvo — reimplante pra aplicar</span>
      </div>
    </div>
  </div>
</template>
