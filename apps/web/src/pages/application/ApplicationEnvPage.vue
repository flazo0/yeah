<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { api, ApiError } from "../../lib/api";
import CodeEditor from "../../components/CodeEditor.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error } = useApplicationContext();
const teamId = useRoute().params.teamId as string;
// Kept out of the template: a literal double brace inside {{ }} ends the interpolation early.
const exampleReference = "{" + "{project.NODE_ENV}" + "}";

const envContent = ref("");
const savingEnv = ref(false);
const envSaved = ref(false);

watchEffect(() => {
  if (app.value) envContent.value = app.value.envContent;
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
    error.value = err instanceof ApiError ? err.message : "falha ao salvar variáveis";
  } finally {
    savingEnv.value = false;
  }
}
</script>

<template>
  <div class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">key</span>
      Variáveis de ambiente
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Uma variável por linha (<span class="mono">CHAVE=valor</span>). Por padrão vale só em tempo de execução (dentro do container).
        Com <span class="mono">build:CHAVE=valor</span> ela existe só durante o build (vira <span class="mono">--build-arg</span>, e some do container);
        com <span class="mono">both:CHAVE=valor</span>, nos dois. Valores podem referenciar
        <RouterLink :to="`/teams/${teamId}/variables`" class="label-link">variáveis compartilhadas</RouterLink>:
        <span class="mono">{{ exampleReference }}</span>. Build args ficam visíveis no histórico da imagem — não use pra segredo que precise ficar fora dela.
      </p>
      <CodeEditor v-model="envContent" language="ini" :height="200" />
      <div class="btn-row mt-16" style="margin-top: 12px">
        <button type="button" class="btn btn-secondary" :disabled="savingEnv" @click="saveEnv">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingEnv ? "salvando..." : "Salvar variáveis" }}
        </button>
        <span v-if="envSaved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
      </div>
    </div>
  </div>
</template>
