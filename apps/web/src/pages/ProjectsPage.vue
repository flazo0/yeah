<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { EnvironmentDto, ProjectDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import ViewToggle from "../components/ViewToggle.vue";
import ListPager from "../components/ListPager.vue";
import Modal from "../components/Modal.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;

const projects = ref<ProjectDto[]>([]);
const loading = ref(true);
const error = ref("");

const view = ref<"list" | "grid">("grid");
const search = ref("");
const sortBy = ref<"name" | "recent" | "resources">("name");
const page = ref(1);
const pageSize = ref(12);
watch([search, sortBy], () => (page.value = 1));

const showCreate = ref(false);
const name = ref("");
const creating = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const rows = projects.value.filter((p) => !q || p.name.toLowerCase().includes(q));
  const sorters = {
    name: (a: ProjectDto, b: ProjectDto) => a.name.localeCompare(b.name),
    recent: (a: ProjectDto, b: ProjectDto) => b.createdAt.localeCompare(a.createdAt),
    resources: (a: ProjectDto, b: ProjectDto) => b.resourceCount - a.resourceCount || a.name.localeCompare(b.name),
  };
  return [...rows].sort(sorters[sortBy.value]);
});
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

function summary(project: ProjectDto): string {
  return `${project.environmentCount} env · ${project.resourceCount} ${project.resourceCount === 1 ? "recurso" : "recursos"}`;
}

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
    showCreate.value = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar projeto";
  } finally {
    creating.value = false;
  }
}

// Quick add: straight to the new-resource catalog when the project has a single environment,
// otherwise to the project page so the environment can be picked.
async function quickAdd(project: ProjectDto) {
  try {
    const res = await api.get<{ environments: EnvironmentDto[] }>(`/teams/${teamId}/projects/${project.id}/environments`);
    const only = res.environments.length === 1 ? res.environments[0] : undefined;
    router.push(only ? `/teams/${teamId}/projects/${project.id}/environments/${only.id}/new` : `/teams/${teamId}/projects/${project.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao abrir o projeto";
  }
}

function open(project: ProjectDto) {
  router.push(`/teams/${teamId}/projects/${project.id}`);
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
      <button type="button" class="btn" @click="showCreate = true">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Novo projeto
      </button>
    </div>

    <div v-if="error && !showCreate" class="alert alert-error mb-16">{{ error }}</div>

    <div class="rtable-toolbar">
      <div class="rtable-search input-icon">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" class="form-control" type="search" placeholder="Buscar projetos" aria-label="Buscar projetos" />
      </div>
      <div class="rtable-filters">
        <select v-model="sortBy" class="form-control" aria-label="Ordenar por">
          <option value="name">Ordenar: nome</option>
          <option value="recent">Ordenar: mais recentes</option>
          <option value="resources">Ordenar: mais recursos</option>
        </select>
      </div>
      <ViewToggle v-model="view" storage-key="yeah:projects-view" />
    </div>

    <PageState :loading="loading" :empty="projects.length === 0" empty-icon="layers" empty-text="Nenhum projeto ainda. Crie o primeiro pelo botão acima.">
      <div v-if="filtered.length === 0" class="empty-state">Nenhum projeto bate com a busca.</div>

      <div v-else-if="view === 'grid'" class="project-grid">
        <div v-for="project in paged" :key="project.id" class="project-card" tabindex="0" @click="open(project)" @keydown.enter="open(project)">
          <div class="project-card-head">
            <span class="rtable-icon"><span class="material-symbols-outlined">layers</span></span>
            <strong>{{ project.name }}</strong>
          </div>
          <div class="project-card-foot">
            <span class="muted">{{ summary(project) }}</span>
            <span class="project-card-actions">
              <button type="button" class="card-icon-btn" title="Adicionar recurso" aria-label="Adicionar recurso" @click.stop="quickAdd(project)">
                <span class="material-symbols-outlined">add</span>
              </button>
              <button type="button" class="card-icon-btn" title="Ambientes do projeto" aria-label="Ambientes do projeto" @click.stop="open(project)">
                <span class="material-symbols-outlined">settings</span>
              </button>
            </span>
          </div>
        </div>
      </div>

      <div v-else class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Ambientes</th>
              <th>Recursos</th>
              <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in paged" :key="project.id">
              <td data-label="Projeto">
                <RouterLink :to="`/teams/${teamId}/projects/${project.id}`" class="rtable-name">
                  <span class="rtable-icon"><span class="material-symbols-outlined">layers</span></span>
                  <strong>{{ project.name }}</strong>
                </RouterLink>
              </td>
              <td data-label="Ambientes">{{ project.environmentCount }}</td>
              <td data-label="Recursos">{{ project.resourceCount }}</td>
              <td data-label="Criado em">{{ new Date(project.createdAt).toLocaleDateString("pt-BR") }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <ListPager v-if="filtered.length > 0" v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" :sizes="[12, 24, 48]" size-key="yeah:projects-page-size" />
    </PageState>

    <Modal v-if="showCreate" title="Novo projeto" @close="showCreate = false">
      <form @submit.prevent="createProject">
        <div class="form-group">
          <label for="project-name">Nome</label>
          <input id="project-name" v-model="name" class="form-control" placeholder="Ex: Meu SaaS" required autofocus />
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="creating">{{ creating ? "criando..." : "Criar projeto" }}</button>
          <button type="button" class="btn btn-secondary" @click="showCreate = false">Cancelar</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
