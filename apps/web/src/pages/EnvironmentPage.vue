<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ApplicationDto, DatabaseDto, ServerDto, ServiceDto, TagDto, TaggableType, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import Breadcrumb from "../components/Breadcrumb.vue";
import ResourceTable, { type ResourceRow } from "../components/ResourceTable.vue";
import Modal from "../components/Modal.vue";

const route = useRoute();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

type Resource = ResourceRow;

const apps = ref<ApplicationDto[]>([]);
const dbs = ref<DatabaseDto[]>([]);
const svcs = ref<ServiceDto[]>([]);
const teamServers = ref<ServerDto[]>([]);
const teamTags = ref<TagDto[]>([]);
const loading = ref(true);
const error = ref("");

function tagsFor(type: TaggableType, id: string) {
  return teamTags.value.filter((tag) => tag.resources.some((r) => r.type === type && r.id === id)).map(({ id: tagId, name, color }) => ({ id: tagId, name, color }));
}

const resources = computed<Resource[]>(() => {
  const list: Resource[] = [
    ...apps.value.map((app) => ({
      kind: "application" as const,
      id: app.id,
      name: app.name,
      status: app.status,
      icon: "deployed_code",
      typeLabel: "Aplicação",
      domain: app.domain,
      detail: `${app.repoUrl} (${app.branch})`,
      serverName: app.serverName,
      path: `${basePath}/apps/${app.id}`,
      tags: tagsFor("application", app.id),
    })),
    ...dbs.value.map((item) => ({
      kind: "database" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      icon: "database",
      typeLabel: "Banco de dados",
      domain: null,
      detail: `${item.engine} · ${item.image}`,
      serverName: item.serverName,
      path: `${basePath}/databases/${item.id}`,
      tags: tagsFor("database", item.id),
    })),
    ...svcs.value.map((item) => ({
      kind: "service" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      icon: "widgets",
      typeLabel: "Serviço",
      domain: item.domain,
      detail: `${item.catalogKey} · ${item.image}`,
      serverName: item.serverName,
      path: `${basePath}/services/${item.id}`,
      tags: tagsFor("service", item.id),
    })),
  ];
  return list.sort((a, b) => a.name.localeCompare(b.name));
});

async function load() {
  loading.value = true;
  try {
    const [appsRes, dbsRes, svcsRes, serversRes, tagsRes] = await Promise.all([
      api.get<{ applications: ApplicationDto[] }>(`${basePath}/applications`),
      api.get<{ databases: DatabaseDto[] }>(`${basePath}/databases`),
      api.get<{ services: ServiceDto[] }>(`${basePath}/services`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
      api.get<{ tags: TagDto[] }>(`/teams/${teamId}/tags`),
    ]);
    teamTags.value = tagsRes.tags;
    apps.value = appsRes.applications;
    dbs.value = dbsRes.databases;
    svcs.value = svcsRes.services;
    teamServers.value = serversRes.servers;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar o ambiente";
  } finally {
    loading.value = false;
  }
}

const pendingDeleteId = ref<string | null>(null);
let pendingDeleteTimer: ReturnType<typeof setTimeout> | undefined;

function armDelete(id: string) {
  if (pendingDeleteId.value === id) return;
  pendingDeleteId.value = id;
  clearTimeout(pendingDeleteTimer);
  pendingDeleteTimer = setTimeout(() => {
    if (pendingDeleteId.value === id) pendingDeleteId.value = null;
  }, 3000);
}

async function deleteResource(resource: Resource) {
  if (pendingDeleteId.value !== resource.id) {
    armDelete(resource.id);
    return;
  }
  pendingDeleteId.value = null;
  clearTimeout(pendingDeleteTimer);
  try {
    if (resource.kind === "application") {
      await api.delete(`${basePath}/applications/${resource.id}`);
      apps.value = apps.value.filter((a) => a.id !== resource.id);
    } else if (resource.kind === "database") {
      await api.delete(`${basePath}/databases/${resource.id}`);
      dbs.value = dbs.value.filter((d) => d.id !== resource.id);
    } else {
      await api.delete(`${basePath}/services/${resource.id}`);
      svcs.value = svcs.value.filter((s) => s.id !== resource.id);
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir recurso";
  }
}

// ---- tag editor
const tagTarget = ref<Resource | null>(null);
const tagSelection = ref<string[]>([]);
const newTagName = ref("");
const tagBusy = ref(false);
const tagError = ref("");
const TAG_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#8b5cf6", "#64748b"];

function openTags(row: Resource) {
  tagTarget.value = row;
  tagSelection.value = (row.tags ?? []).map((tag) => tag.id);
  newTagName.value = "";
  tagError.value = "";
}

async function createTag() {
  const name = newTagName.value.trim();
  if (!name) return;
  tagBusy.value = true;
  tagError.value = "";
  try {
    const color = TAG_COLORS[teamTags.value.length % TAG_COLORS.length];
    const res = await api.post<{ tag: TagDto }>(`/teams/${teamId}/tags`, { name, color });
    teamTags.value = [...teamTags.value, res.tag].sort((a, b) => a.name.localeCompare(b.name));
    tagSelection.value = [...tagSelection.value, res.tag.id];
    newTagName.value = "";
  } catch (err) {
    tagError.value = err instanceof ApiError ? err.message : "falha ao criar a etiqueta";
  } finally {
    tagBusy.value = false;
  }
}

async function deleteTag(tag: TagDto) {
  tagBusy.value = true;
  tagError.value = "";
  try {
    await api.delete(`/teams/${teamId}/tags/${tag.id}`);
    teamTags.value = teamTags.value.filter((t) => t.id !== tag.id);
    tagSelection.value = tagSelection.value.filter((id) => id !== tag.id);
  } catch (err) {
    tagError.value = err instanceof ApiError ? err.message : "falha ao apagar a etiqueta";
  } finally {
    tagBusy.value = false;
  }
}

async function saveTags() {
  if (!tagTarget.value) return;
  tagBusy.value = true;
  tagError.value = "";
  try {
    const res = await api.put<{ tags: TagDto[] }>(`/teams/${teamId}/tags/assign`, {
      resourceType: tagTarget.value.kind,
      resourceId: tagTarget.value.id,
      tagIds: tagSelection.value,
    });
    teamTags.value = res.tags;
    tagTarget.value = null;
  } catch (err) {
    tagError.value = err instanceof ApiError ? err.message : "falha ao salvar as etiquetas";
  } finally {
    tagBusy.value = false;
  }
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "database.status") {
      const database = dbs.value.find((d) => d.id === event.databaseId);
      if (database) database.status = event.status;
    }
    if (event.type === "service.status") {
      const service = svcs.value.find((s) => s.id === event.serviceId);
      if (service) service.status = event.status;
    }
  });
});
onUnmounted(() => {
  unsubscribe?.();
  clearTimeout(pendingDeleteTimer);
});
</script>

<template>
  <div>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" />
    <div class="page-header">
      <div>
        <h1>Recursos</h1>
        <p>Aplicações, bancos de dados e serviços deste ambiente.</p>
      </div>
      <RouterLink v-if="teamServers.length > 0" :to="`${basePath}/new`" class="btn">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Novo recurso
      </RouterLink>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!loading && teamServers.length === 0" class="card mb-16">
      <div class="card-body">
        <div class="empty-state">
          Você precisa de um <RouterLink :to="`/teams/${teamId}/servers`" class="label-link">servidor conectado</RouterLink>
          antes de criar aplicações, bancos de dados ou serviços.
        </div>
      </div>
    </div>

    <ResourceTable :items="resources" :loading="loading" :pending-delete-id="pendingDeleteId" @delete="deleteResource" @tags="openTags">
      <template #empty>
        Nenhum recurso ainda.
        <template v-if="teamServers.length > 0">
          <RouterLink :to="`${basePath}/new`" class="label-link">Crie o primeiro</RouterLink>.
        </template>
      </template>
    </ResourceTable>

    <Modal v-if="tagTarget" :title="`Etiquetas — ${tagTarget.name}`" @close="tagTarget = null">
      <div v-if="tagError" class="alert alert-error mb-16">{{ tagError }}</div>
      <p v-if="teamTags.length === 0" class="hint mb-16">Nenhuma etiqueta ainda. Crie a primeira abaixo.</p>
      <div v-for="tag in teamTags" :key="tag.id" class="tag-option">
        <label>
          <input v-model="tagSelection" type="checkbox" :value="tag.id" />
          <span class="tag-chip" :style="{ '--tag': tag.color }">{{ tag.name }}</span>
        </label>
        <button type="button" class="rtable-delete" title="Apagar etiqueta (de todos os recursos)" :aria-label="`Apagar etiqueta ${tag.name}`" :disabled="tagBusy" @click="deleteTag(tag)">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
      <form class="btn-row" style="margin: 16px 0" @submit.prevent="createTag">
        <input v-model="newTagName" class="form-control" maxlength="50" placeholder="Nova etiqueta" aria-label="Nome da nova etiqueta" />
        <button type="submit" class="btn btn-secondary" :disabled="tagBusy || !newTagName.trim()">Criar</button>
      </form>
      <div class="btn-row">
        <button type="button" class="btn" :disabled="tagBusy" @click="saveTags">Salvar</button>
        <button type="button" class="btn btn-secondary" @click="tagTarget = null">Cancelar</button>
      </div>
    </Modal>
  </div>
</template>
