<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { parseEnvContent, serializeEnvEntries, type EnvAvailability } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import CodeEditor from "../../components/CodeEditor.vue";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error, reloadApp } = useApplicationContext();
const teamId = useRoute().params.teamId as string;
// Kept out of the template: a literal double brace inside {{ }} ends the interpolation early.
const exampleReference = "{" + "{project.NODE_ENV}" + "}";

const envContent = ref("");
const savingEnv = ref(false);
const envSaved = ref(false);

interface Row {
  key: string;
  value: string;
  availability: EnvAvailability;
  reveal: boolean;
}
const rows = ref<Row[]>([]);
const MODE_KEY = "yeah:env-mode";
function readMode(): "text" | "table" {
  try {
    return localStorage.getItem(MODE_KEY) === "table" ? "table" : "text";
  } catch {
    return "text";
  }
}
const mode = ref<"text" | "table">(readMode());

watchEffect(() => {
  if (!app.value) return;
  envContent.value = app.value.envContent;
  if (mode.value === "table") loadRows();
});

function loadRows() {
  rows.value = parseEnvContent(envContent.value).map((e) => ({ ...e, reveal: false }));
}

function setMode(next: "text" | "table") {
  if (next === mode.value) return;
  if (next === "table") loadRows();
  else envContent.value = tableText.value;
  mode.value = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    // preference only
  }
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const rowError = (row: Row): string => {
  if (!row.key) return "";
  if (!KEY_RE.test(row.key)) return "nome inválido (letras, números e _)";
  if (rows.value.filter((r) => r.key === row.key).length > 1) return "nome repetido";
  return "";
};
const hasRowErrors = computed(() => rows.value.some((r) => rowError(r) !== ""));
const tableText = computed(() => serializeEnvEntries(rows.value.filter((r) => r.key).map(({ key, value, availability }) => ({ key, value, availability }))));

function addRow() {
  rows.value.push({ key: "", value: "", availability: "runtime", reveal: true });
}

async function saveEnv() {
  if (mode.value === "table" && hasRowErrors.value) {
    error.value = "corrija os nomes marcados na tabela antes de salvar";
    return;
  }
  savingEnv.value = true;
  envSaved.value = false;
  error.value = "";
  try {
    const content = mode.value === "table" ? tableText.value : envContent.value;
    await api.put(`${basePath}/env`, { envContent: content });
    if (mode.value === "table") envContent.value = content;
    envSaved.value = true;
    setTimeout(() => (envSaved.value = false), 2000);
    void reloadApp();
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
      <div class="segmented" style="margin-left: auto" role="group" aria-label="Modo de edição">
        <button type="button" :class="{ active: mode === 'text' }" @click="setMode('text')">Texto</button>
        <button type="button" :class="{ active: mode === 'table' }" @click="setMode('table')">Tabela</button>
      </div>
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Por padrão a variável vale só em tempo de execução (dentro do container).
        Com <span class="mono">build:CHAVE=valor</span> (na tabela: "Só build") ela existe só durante o build (vira <span class="mono">--build-arg</span>, e some do container);
        com <span class="mono">both:</span> ("Build e execução"), nos dois. Valores podem referenciar
        <RouterLink :to="`/teams/${teamId}/variables`" class="label-link">variáveis compartilhadas</RouterLink>:
        <span class="mono">{{ exampleReference }}</span>. Build args ficam visíveis no histórico da imagem — não use pra segredo que precise ficar fora dela.
      </p>

      <CodeEditor v-if="mode === 'text'" v-model="envContent" language="ini" :height="200" />

      <template v-else>
        <div class="env-table-wrap">
          <table class="env-table">
            <thead>
              <tr><th>Nome</th><th>Valor</th><th>Disponível em</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in rows" :key="i">
                <td data-label="Nome">
                  <input v-model="row.key" class="form-control mono" :class="{ invalid: rowError(row) }" placeholder="NOME" :aria-label="`Nome da variável ${i + 1}`" />
                  <small v-if="rowError(row)" class="field-error">{{ rowError(row) }}</small>
                </td>
                <td data-label="Valor">
                  <div class="env-value">
                    <input v-model="row.value" class="form-control mono" :type="row.reveal ? 'text' : 'password'" autocomplete="off" placeholder="valor" :aria-label="`Valor da variável ${i + 1}`" />
                    <button type="button" class="rtable-delete" :title="row.reveal ? 'Ocultar' : 'Mostrar'" :aria-label="row.reveal ? 'Ocultar valor' : 'Mostrar valor'" @click="row.reveal = !row.reveal">
                      <span class="material-symbols-outlined">{{ row.reveal ? "visibility_off" : "visibility" }}</span>
                    </button>
                  </div>
                </td>
                <td data-label="Disponível em">
                  <select v-model="row.availability" class="form-control" :aria-label="`Disponibilidade da variável ${i + 1}`">
                    <option value="runtime">Só execução</option>
                    <option value="build">Só build</option>
                    <option value="both">Build e execução</option>
                  </select>
                </td>
                <td>
                  <button type="button" class="rtable-delete" title="Remover" aria-label="Remover variável" @click="rows.splice(i, 1)">
                    <span class="material-symbols-outlined">delete</span>
                  </button>
                </td>
              </tr>
              <tr v-if="rows.length === 0"><td colspan="4" class="muted">Nenhuma variável ainda.</td></tr>
            </tbody>
          </table>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 8px" @click="addRow">
          <span class="material-symbols-outlined" style="font-size: 16px">add</span>
          Adicionar variável
        </button>
        <p class="hint" style="margin-top: 8px">A visão em tabela não guarda comentários (<span class="mono"># ...</span>) nem linhas em branco do modo texto.</p>
      </template>

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
