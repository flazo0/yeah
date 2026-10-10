<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../../lib/api";
import CodeEditor from "../../components/CodeEditor.vue";
import { useServiceContext } from "../../composables/useServiceContext";
import { i18n } from "../../lib/i18n";

const { service, basePath, error } = useServiceContext();

const envContent = ref("");
const savingEnv = ref(false);
const envSaved = ref(false);

watchEffect(() => {
  if (service.value) envContent.value = service.value.envContent;
});

async function saveEnv() {
  savingEnv.value = true;
  envSaved.value = false;
  error.value = "";
  try {
    await api.put(`${basePath}/env`, { envContent: envContent.value });
    envSaved.value = true;
    setTimeout(() => (envSaved.value = false), 2000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceEnv.falhaAoSalvarVariaveis");
  } finally {
    savingEnv.value = false;
  }
}
</script>

<template>
  <div class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">key</span>
      {{ $t("serviceEnv.variaveisDeAmbiente") }}
    </div>
    <div class="card-body">
      <CodeEditor v-model="envContent" language="ini" :height="200" />
      <div class="btn-row mt-16" style="margin-top: 12px">
        <button type="button" class="btn btn-secondary" :disabled="savingEnv" @click="saveEnv">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingEnv ? $t("serviceEnv.salvando") : "Salvar" }}
        </button>
        <span v-if="envSaved" class="muted" style="align-self: center; font-size: 13px">{{ $t("serviceEnv.salvoReimplantePraAplicar") }}</span>
      </div>
    </div>
  </div>
</template>
