<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { DatabaseDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useDatabaseContext } from "../../composables/useDatabaseContext";

const { database, basePath, error } = useDatabaseContext();

const limitsForm = ref<{ memoryLimitMb: number | null; cpuLimit: number | null }>({ memoryLimitMb: null, cpuLimit: null });
const savingLimits = ref(false);
const limitsSaved = ref(false);

watchEffect(() => {
  if (!database.value) return;
  limitsForm.value = { memoryLimitMb: database.value.memoryLimitMb, cpuLimit: database.value.cpuLimit };
});

async function saveLimits() {
  savingLimits.value = true;
  limitsSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ database: DatabaseDto }>(`${basePath}/limits`, {
      memoryLimitMb: limitsForm.value.memoryLimitMb || null,
      cpuLimit: limitsForm.value.cpuLimit || null,
    });
    database.value = res.database;
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
  <div v-if="database" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      Geral
    </div>
    <div class="card-body">
      <div class="grid grid-2">
        <div>
          <div class="stat-label">Motor</div>
          <div class="mono">{{ database.engine }}</div>
        </div>
        <div>
          <div class="stat-label">Imagem</div>
          <div class="mono">{{ database.image }}</div>
        </div>
        <div>
          <div class="stat-label">Servidor</div>
          <div>{{ database.serverName }}</div>
        </div>
        <div>
          <div class="stat-label">Porta</div>
          <div class="mono">{{ database.port }}</div>
        </div>
        <div v-if="database.username">
          <div class="stat-label">Usuário</div>
          <div class="mono">{{ database.username }}</div>
        </div>
        <div v-if="database.databaseName">
          <div class="stat-label">Database</div>
          <div class="mono">{{ database.databaseName }}</div>
        </div>
      </div>
    </div>
    <div class="card-header" style="border-top: 1px solid var(--border)">
      <span class="material-symbols-outlined" style="font-size: 18px">speed</span>
      Limites de recurso
    </div>
    <div class="card-body">
      <p class="hint mb-16">Deixe em branco pra não limitar. Recria o container imediatamente ao salvar.</p>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="db-limit-mem">Memória (MB)</label>
          <input id="db-limit-mem" v-model.number="limitsForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="db-limit-cpu">CPU (cores)</label>
          <input id="db-limit-cpu" v-model.number="limitsForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingLimits" @click="saveLimits">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingLimits ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="limitsSaved" class="muted" style="align-self: center; font-size: 13px">salvo — recriando container</span>
      </div>
    </div>
  </div>
</template>
