<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../../lib/api";
import CodeEditor from "../../components/CodeEditor.vue";
import { useServiceContext } from "../../composables/useServiceContext";
import { i18n } from "../../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serviceCompose.falhaAoSalvar");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="service">
    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">stacks</span> {{ $t("serviceCompose.dockerComposeYml") }}</div>
      <div class="card-body">
        <p class="hint mb-16">
          {{ $t("serviceCompose.oComposeQueRodaEste") }} <span class="mono">{{ $t("serviceCompose.image") }}</span> {{ $t("serviceCompose.sem") }} <span class="mono">{{ $t("serviceCompose.build") }}</span>{{ $t("serviceCompose.oYeahAcrescentaNumArquivo") }} <strong>{{ $t("serviceCompose.reimplantar") }}</strong>.
        </p>
        <CodeEditor v-model="compose" language="yaml" :height="360" />
      </div>
    </div>
    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">key</span> {{ $t("serviceCompose.variaveisEnv") }}</div>
      <div class="card-body">
        <p class="hint mb-16">{{ $t("serviceCompose.lidasPeloComposeComo") }} <span class="mono">${NOME}</span>{{ $t("serviceCompose.segredosGeradosNaCriacaoFicam") }}</p>
        <CodeEditor v-model="envContent" language="ini" :height="200" />
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("serviceCompose.salvando") : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("serviceCompose.salvoCliqueEmReimplantarPra") }}</span>
    </div>
  </div>
</template>
