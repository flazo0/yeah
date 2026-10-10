<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { EnvironmentDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import { i18n } from "../lib/i18n";

const route = useRoute();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;

const environments = ref<EnvironmentDto[]>([]);
const loading = ref(true);
const error = ref("");

const name = ref("");
const creating = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ environments: EnvironmentDto[] }>(
      `/teams/${teamId}/projects/${projectId}/environments`,
    );
    environments.value = res.environments;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("project.falhaAoCarregarAmbientes");
  } finally {
    loading.value = false;
  }
}

async function createEnvironment() {
  if (!name.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const res = await api.post<{ environment: EnvironmentDto }>(
      `/teams/${teamId}/projects/${projectId}/environments`,
      { name: name.value.trim() },
    );
    environments.value.push(res.environment);
    name.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("project.falhaAoCriarAmbiente");
  } finally {
    creating.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("project.ambientes") }}</h1>
        <p>{{ $t("project.cadaAmbienteTemSuaPropria") }}</p>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body"><PageState loading /></div></div>
    <div v-else-if="environments.length === 0" class="card mb-16">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">layers</span>
          {{ $t("project.nenhumAmbienteAinda") }}
        </div>
      </div>
    </div>
    <div v-else class="quick-links mb-16">
      <RouterLink
        v-for="environment in environments"
        :key="environment.id"
        :to="`/teams/${teamId}/projects/${projectId}/environments/${environment.id}`"
        class="quick-link"
      >
        <div class="name">{{ environment.name }}</div>
        <div class="desc">{{ $t("project.p0AplicacaoOesP1Banco", { p0: environment.applicationCount, p1: environment.databaseCount }) }}</div>
      </RouterLink>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        {{ $t("project.novoAmbiente") }}
      </div>
      <div class="card-body">
        <form class="form-row" style="align-items: end" @submit.prevent="createEnvironment">
          <div class="form-group" style="margin-bottom: 0">
            <label for="env-name">{{ $t("project.nome") }}</label>
            <input id="env-name" v-model="name" class="form-control" :placeholder="$t('project.staging')" required />
          </div>
          <button type="submit" class="btn" :disabled="creating">
            {{ creating ? $t("project.criando") : $t("project.criarAmbiente") }}
          </button>
        </form>
        <div v-if="error" class="alert alert-error" style="margin-top: 12px">{{ error }}</div>
      </div>
    </div>
  </div>
</template>
