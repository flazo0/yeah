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

const restoring = ref(false);
const restoreMessage = ref("");

async function restoreDefaults() {
  restoring.value = true;
  restoreMessage.value = "";
  error.value = "";
  try {
    const res = await api.post<{ service: typeof service.value; added: string[] }>(`${basePath}/env/restore-defaults`, {});
    if (res.service) service.value = res.service;
    restoreMessage.value = res.added.length ? i18n.global.t("serviceEnv.restauradas", { vars: res.added.join(", ") }) : i18n.global.t("serviceEnv.nadaAFazer");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceEnv.falhaAoRestaurar");
  } finally {
    restoring.value = false;
  }
}

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
        <button v-if="service?.templateKey" type="button" class="btn btn-secondary" :disabled="restoring" :title="$t('serviceEnv.restaurarDica')" @click="restoreDefaults">
          <span class="material-symbols-outlined" style="font-size: 18px">restart_alt</span>
          {{ $t("serviceEnv.restaurar") }}
        </button>
        <span v-if="restoreMessage" class="muted" style="align-self: center; font-size: 13px">{{ restoreMessage }}</span>
        <span v-if="envSaved" class="muted" style="align-self: center; font-size: 13px">{{ $t("serviceEnv.salvoReimplantePraAplicar") }}</span>
      </div>
    </div>
  </div>
</template>
