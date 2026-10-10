<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { EnvironmentDto, ProjectDto, SharedVariableDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import Modal from "../components/Modal.vue";
import { i18n } from "../lib/i18n";

const route = useRoute();
// Kept out of the template: a literal double brace inside {{ }} ends the interpolation early.
const exampleReference = "{" + "{project.NODE_ENV}" + "}";
const teamId = route.params.teamId as string;

const variables = ref<SharedVariableDto[]>([]);
const projects = ref<ProjectDto[]>([]);
const environmentsByProject = ref<Record<string, EnvironmentDto[]>>({});
const loading = ref(true);
const error = ref("");

const scopeTab = ref<"team" | "project" | "environment">("team");
const showCreate = ref(false);
const form = ref({ projectId: "", environmentId: "", key: "", value: "" });
const saving = ref(false);
const editingId = ref<string | null>(null);
const editValue = ref("");
const pendingDelete = ref<string | null>(null);
let deleteTimer: ReturnType<typeof setTimeout> | undefined;
const copied = ref<string | null>(null);

const scopeLabels = { team: i18n.global.t("common.team"), project: i18n.global.t("common.project"), environment: i18n.global.t("common.environment") } as const;
const scopeHints = {
  team: i18n.global.t("variables.valePraTodasAsAplicacoes"),
  project: i18n.global.t("variables.valePrasAplicacoesDeUm"),
  environment: i18n.global.t("variables.valeSoPrasAplicacoesDe"),
} as const;

const environmentChoices = computed(() =>
  projects.value.flatMap((p) => (environmentsByProject.value[p.id] ?? []).map((e) => ({ id: e.id, label: `${p.name} / ${e.name}` }))),
);
const environmentLabel = computed(() => new Map(environmentChoices.value.map((e) => [e.id, e.label])));
const projectLabel = computed(() => new Map(projects.value.map((p) => [p.id, p.name])));

const shown = computed(() =>
  variables.value.filter((v) => v.scope === scopeTab.value).sort((a, b) => a.key.localeCompare(b.key)),
);

function reference(v: SharedVariableDto): string {
  return `{{${v.scope}.${v.key}}}`;
}
function targetOf(v: SharedVariableDto): string {
  if (v.scope === "project") return projectLabel.value.get(v.projectId ?? "") ?? "projeto removido";
  if (v.scope === "environment") return environmentLabel.value.get(v.environmentId ?? "") ?? "ambiente removido";
  return i18n.global.t("variables.todoOTime");
}

async function load() {
  loading.value = true;
  try {
    const [vars, projs] = await Promise.all([
      api.get<{ variables: SharedVariableDto[] }>(`/teams/${teamId}/variables`),
      api.get<{ projects: ProjectDto[] }>(`/teams/${teamId}/projects`),
    ]);
    variables.value = vars.variables;
    projects.value = projs.projects;
    const entries = await Promise.all(
      projs.projects.map(async (p) => {
        const res = await api.get<{ environments: EnvironmentDto[] }>(`/teams/${teamId}/projects/${p.id}/environments`);
        return [p.id, res.environments] as const;
      }),
    );
    environmentsByProject.value = Object.fromEntries(entries);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("variables.falhaAoCarregarVariaveis");
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.value = { projectId: projects.value[0]?.id ?? "", environmentId: environmentChoices.value[0]?.id ?? "", key: "", value: "" };
  error.value = "";
  showCreate.value = true;
}

async function create() {
  saving.value = true;
  error.value = "";
  try {
    const res = await api.post<{ variable: SharedVariableDto }>(`/teams/${teamId}/variables`, {
      scope: scopeTab.value,
      projectId: scopeTab.value === "project" ? form.value.projectId : undefined,
      environmentId: scopeTab.value === "environment" ? form.value.environmentId : undefined,
      key: form.value.key.trim(),
      value: form.value.value,
    });
    variables.value.push(res.variable);
    showCreate.value = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("variables.falhaAoCriarAVariavel");
  } finally {
    saving.value = false;
  }
}

function startEdit(v: SharedVariableDto) {
  editingId.value = v.id;
  editValue.value = v.value;
}

async function saveEdit(v: SharedVariableDto) {
  try {
    const res = await api.put<{ variable: SharedVariableDto }>(`/teams/${teamId}/variables/${v.id}`, { value: editValue.value });
    v.value = res.variable.value;
    editingId.value = null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("variables.falhaAoSalvar");
  }
}

async function remove(v: SharedVariableDto) {
  if (pendingDelete.value !== v.id) {
    pendingDelete.value = v.id;
    clearTimeout(deleteTimer);
    deleteTimer = setTimeout(() => (pendingDelete.value = null), 3000);
    return;
  }
  pendingDelete.value = null;
  try {
    await api.delete(`/teams/${teamId}/variables/${v.id}`);
    variables.value = variables.value.filter((x) => x.id !== v.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("variables.falhaAoExcluir");
  }
}

async function copyReference(v: SharedVariableDto) {
  try {
    await navigator.clipboard.writeText(reference(v));
    copied.value = v.id;
    setTimeout(() => (copied.value = null), 1500);
  } catch {
    copied.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("variables.variaveisCompartilhadas") }}</h1>
        <p>
          {{ $t("variables.declareUmaVezUseEm") }} <span class="mono">{{ $t("variables.env") }}</span> {{ $t("variables.daAplicacaoEscreva") }}
          <span class="mono">{{ exampleReference }}</span> {{ $t("variables.ou") }} <span class="mono">{{ $t("variables.team") }}</span> / <span class="mono">{{ $t("variables.environment") }}</span>{{ $t("variables.eOValorEntraNo") }}
        </p>
      </div>
      <button type="button" class="btn" @click="openCreate">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        {{ $t("variables.novaVariavel") }}
      </button>
    </div>

    <div v-if="error && !showCreate" class="alert alert-error mb-16">{{ error }}</div>

    <div class="detail-tabs">
      <button
        v-for="scope in (['team', 'project', 'environment'] as const)"
        :key="scope"
        type="button"
        class="detail-tab"
        :class="{ active: scopeTab === scope }"
        @click="scopeTab = scope"
      >
        {{ scopeLabels[scope] }}
        <span class="badge badge-neutral">{{ variables.filter((v) => v.scope === scope).length }}</span>
      </button>
    </div>
    <p class="hint mb-16">{{ scopeHints[scopeTab] }}</p>

    <PageState :loading="loading" :empty="shown.length === 0" empty-icon="data_object" :empty-text="$t('variables.nenhumaVariavelNesseEscopoAinda')">
      <div class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>{{ $t("variables.nome") }}</th>
              <th v-if="scopeTab !== 'team'">{{ scopeLabels[scopeTab] }}</th>
              <th>{{ $t("variables.valor") }}</th>
              <th class="rtable-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in shown" :key="v.id">
              <td :data-label="$t('variables.labelNome')">
                <strong class="mono">{{ v.key }}</strong>
                <br />
                <button type="button" class="label-link mono" style="background: none; border: none; cursor: pointer; padding: 0; font-size: 12px" @click="copyReference(v)">
                  {{ copied === v.id ? "copiado" : reference(v) }}
                </button>
              </td>
              <td v-if="scopeTab !== 'team'" :data-label="scopeLabels[scopeTab]">{{ targetOf(v) }}</td>
              <td :data-label="$t('variables.labelValor')" style="min-width: 220px">
                <form v-if="editingId === v.id" class="btn-row" @submit.prevent="saveEdit(v)">
                  <input v-model="editValue" class="form-control mono" :aria-label="$t('variables.valor')" />
                  <button type="submit" class="btn btn-sm">{{ $t("variables.salvar") }}</button>
                  <button type="button" class="btn btn-secondary btn-sm" @click="editingId = null">{{ $t("variables.cancelar") }}</button>
                </form>
                <button v-else type="button" class="mono" style="background: none; border: none; cursor: pointer; padding: 0; text-align: left; color: var(--ink)" :title="$t('variables.editar')" @click="startEdit(v)">
                  {{ v.value || "(vazio)" }}
                </button>
              </td>
              <td class="rtable-actions-col">
                <button type="button" class="rtable-delete" :class="{ confirming: pendingDelete === v.id }" :title="pendingDelete === v.id ? $t('variables.cliqueDeNovoPraConfirmar') : 'Excluir'" @click="remove(v)">
                  <span class="material-symbols-outlined">{{ pendingDelete === v.id ? "warning" : "delete" }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageState>

    <Modal v-if="showCreate" :title="$t('variables.novaVariavelP0', { p0: scopeLabels[scopeTab].toLowerCase() })" @close="showCreate = false">
      <form @submit.prevent="create">
        <div v-if="scopeTab === 'project'" class="form-group">
          <label for="var-project">{{ $t("variables.projeto") }}</label>
          <select id="var-project" v-model="form.projectId" class="form-control" required>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div v-if="scopeTab === 'environment'" class="form-group">
          <label for="var-env">{{ $t("variables.ambiente") }}</label>
          <select id="var-env" v-model="form.environmentId" class="form-control" required>
            <option v-for="e in environmentChoices" :key="e.id" :value="e.id">{{ e.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="var-key">{{ $t("variables.nome") }}</label>
          <input id="var-key" v-model="form.key" class="form-control mono" placeholder="NODE_ENV" required autofocus />
        </div>
        <div class="form-group">
          <label for="var-value">{{ $t("variables.valor") }}</label>
          <input id="var-value" v-model="form.value" class="form-control mono" />
          <p class="hint" style="margin-top: 6px">{{ $t("variables.guardadoCriptografadoNoPainel") }}</p>
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="saving">{{ saving ? $t("variables.criando") : $t("variables.criarVariavel") }}</button>
          <button type="button" class="btn btn-secondary" @click="showCreate = false">{{ $t("variables.cancelar") }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
