<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ProjectDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";

const route = useRoute();
const teamId = route.params.teamId as string;

const projects = ref<ProjectDto[]>([]);
const loading = ref(true);
const error = ref("");

const name = ref("");
const creating = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ projects: ProjectDto[] }>(`/teams/${teamId}/projects`);
    projects.value = res.projects;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar projetos";
  } finally {
    loading.value = false;
  }
}

async function createProject() {
  if (!name.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const res = await api.post<{ project: ProjectDto }>(`/teams/${teamId}/projects`, { name: name.value.trim() });
    projects.value.push(res.project);
    name.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar projeto";
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
        <h1>Projetos</h1>
        <p>Cada projeto agrupa ambientes (production, staging...) com seus próprios recursos.</p>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="card-body"><div class="empty-state">carregando...</div></div></div>
    <div v-else-if="projects.length === 0" class="card mb-16">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">layers</span>
          Nenhum projeto ainda.
        </div>
      </div>
    </div>
    <div v-else class="quick-links mb-16">
      <RouterLink v-for="project in projects" :key="project.id" :to="`/teams/${teamId}/projects/${project.id}`" class="quick-link">
        <div class="name">
          {{ project.name }}
          <span class="badge badge-neutral">{{ project.environmentCount }} ambiente(s)</span>
        </div>
        <div class="desc">Criado em {{ new Date(project.createdAt).toLocaleDateString("pt-BR") }}</div>
      </RouterLink>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Novo projeto
      </div>
      <div class="card-body">
        <form class="form-row" style="align-items: end" @submit.prevent="createProject">
          <div class="form-group" style="margin-bottom: 0">
            <label for="project-name">Nome</label>
            <input id="project-name" v-model="name" class="form-control" placeholder="Ex: Meu SaaS" required />
          </div>
          <button type="submit" class="btn" :disabled="creating">
            {{ creating ? "criando..." : "Criar projeto" }}
          </button>
        </form>
        <div v-if="error" class="alert alert-error" style="margin-top: 12px">{{ error }}</div>
      </div>
    </div>
  </div>
</template>
