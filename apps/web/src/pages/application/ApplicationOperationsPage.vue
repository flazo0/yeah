<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { EnvironmentDto, ProjectDto, ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

const { app, basePath, error, reloadApp } = useApplicationContext();
const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;

interface Place {
  environmentId: string;
  projectId: string;
  label: string;
}
const places = ref<Place[]>([]);
const servers = ref<ServerDto[]>([]);

const cloneName = ref("");
const cloneEnv = ref("");
const cloneServer = ref("");
const moveEnv = ref("");
const busy = ref(false);
const message = ref("");

onMounted(async () => {
  try {
    const [projectsRes, serversRes] = await Promise.all([
      api.get<{ projects: ProjectDto[] }>(`/teams/${teamId}/projects`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
    ]);
    servers.value = serversRes.servers;
    for (const project of projectsRes.projects) {
      const envs = await api.get<{ environments: EnvironmentDto[] }>(`/teams/${teamId}/projects/${project.id}/environments`);
      for (const env of envs.environments) places.value.push({ environmentId: env.id, projectId: project.id, label: `${project.name} / ${env.name}` });
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationOperations.failedLoadProjectsServers");
  }
  cloneName.value = app.value ? `${app.value.name}-copy` : "";
  cloneEnv.value = app.value?.environmentId ?? "";
  cloneServer.value = app.value?.serverId ?? "";
});

async function clone() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    const res = await api.post<{ application: { id: string }; environmentId: string }>(`${basePath}/clone`, {
      name: cloneName.value,
      environmentId: cloneEnv.value,
      serverId: cloneServer.value,
    });
    const place = places.value.find((p) => p.environmentId === res.environmentId);
    if (place) router.push(`/teams/${teamId}/projects/${place.projectId}/environments/${place.environmentId}/apps/${res.application.id}/general`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationOperations.failedToClone");
  } finally {
    busy.value = false;
  }
}

async function move() {
  if (!moveEnv.value) return;
  busy.value = true;
  error.value = "";
  message.value = "";
  try {
    await api.put(`${basePath}/move`, { environmentId: moveEnv.value });
    const place = places.value.find((p) => p.environmentId === moveEnv.value);
    if (place) router.push(`/teams/${teamId}/projects/${place.projectId}/environments/${place.environmentId}/apps/${app.value!.id}/operations`);
    else await reloadApp();
    message.value = i18n.global.t("applicationOperations.applicationMoved");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationOperations.failedToMove");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="app">
    <form class="card mb-16" @submit.prevent="clone">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">content_copy</span>
        {{ $t("applicationOperations.clone") }}
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          {{ $t("applicationOperations.createsCopySameSettingsSource") }} <strong>{{ $t("applicationOperations.doNot") }}</strong> {{ $t("applicationOperations.comeAlongTwoAppsCan") }}
        </p>
        <div class="form-group">
          <label for="clone-name">{{ $t("applicationOperations.name") }}</label>
          <input id="clone-name" v-model="cloneName" class="form-control" required />
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="clone-env">{{ $t("applicationOperations.environment2") }}</label>
            <select id="clone-env" v-model="cloneEnv" class="form-control">
              <option v-for="p in places" :key="p.environmentId" :value="p.environmentId">{{ p.label }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="clone-server">{{ $t("applicationOperations.server") }}</label>
            <select id="clone-server" v-model="cloneServer" class="form-control">
              <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-secondary" :disabled="busy || !cloneName.trim()">{{ $t("applicationOperations.cloneApplication") }}</button>
      </div>
    </form>

    <form class="card" style="margin-bottom: 0" @submit.prevent="move">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">drive_file_move</span>
        {{ $t("applicationOperations.moveAnotherEnvironment") }}
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          {{ $t("applicationOperations.onlyChangesWhereApplicationAppears") }}
          <span class="mono">{{ $t("applicationOperations.project") }}</span> {{ $t("applicationOperations.or") }} <span class="mono">{{ $t("applicationOperations.environment") }}</span> {{ $t("applicationOperations.startPointingNewLocationNext") }}
        </p>
        <div class="form-group">
          <label for="move-env">{{ $t("applicationOperations.destination") }}</label>
          <select id="move-env" v-model="moveEnv" class="form-control">
            <option value="">{{ $t("applicationOperations.chooseAnEnvironment") }}</option>
            <option v-for="p in places.filter((x) => x.environmentId !== app!.environmentId)" :key="p.environmentId" :value="p.environmentId">{{ p.label }}</option>
          </select>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-secondary" :disabled="busy || !moveEnv">{{ $t("applicationOperations.move") }}</button>
          <span v-if="message" class="muted" style="align-self: center; font-size: 13px">{{ message }}</span>
        </div>
      </div>
    </form>
  </div>
</template>
