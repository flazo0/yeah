<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../../lib/api";
import CodeEditor from "../../components/CodeEditor.vue";
import { useServiceContext } from "../../composables/useServiceContext";

const { service, basePath, error, reloadService } = useServiceContext();

const compose = ref("");
const envContent = ref("");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  if (service.value) {
    compose.value = service.value.composeContent ?? "";
    envContent.value = service.value.envContent;
  }
});

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    await api.put(`${basePath}/compose`, { composeContent: compose.value, envContent: envContent.value });
    await reloadService();
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="service">
    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">stacks</span> docker-compose.yml</div>
      <div class="card-body">
        <p class="hint mb-16">
          O compose que roda este serviço. Só <span class="mono">image</span> (sem <span class="mono">build</span>). O yeah acrescenta, num arquivo à parte, a rede do ambiente e os labels do proxy —
          o seu YAML não é alterado. Vale a partir do próximo <strong>Reimplantar</strong>.
        </p>
        <CodeEditor v-model="compose" language="yaml" :height="360" />
      </div>
    </div>
    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">key</span> Variáveis (.env)</div>
      <div class="card-body">
        <p class="hint mb-16">Lidas pelo compose como <span class="mono">${NOME}</span>. Segredos gerados na criação ficam aqui e podem ser trocados.</p>
        <CodeEditor v-model="envContent" language="ini" :height="200" />
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? "salvando..." : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">salvo — clique em Reimplantar pra aplicar</span>
    </div>
  </div>
</template>
