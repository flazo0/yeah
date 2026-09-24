<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { EnvironmentDto, ProjectDto, ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

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
    error.value = err instanceof ApiError ? err.message : "falha ao carregar projetos e servidores";
  }
  cloneName.value = app.value ? `${app.value.name}-copia` : "";
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
    error.value = err instanceof ApiError ? err.message : "falha ao clonar";
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
    message.value = "Aplicação movida.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao mover";
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
        Clonar
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          Cria uma cópia com as mesmas configurações: origem, variáveis, armazenamento, healthcheck e limites. Os domínios e o token de deploy <strong>não</strong> vêm
          (dois apps não podem responder no mesmo domínio), e as tarefas agendadas vêm pausadas. A cópia não é deployada sozinha.
        </p>
        <div class="form-group">
          <label for="clone-name">Nome</label>
          <input id="clone-name" v-model="cloneName" class="form-control" required />
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="clone-env">Ambiente</label>
            <select id="clone-env" v-model="cloneEnv" class="form-control">
              <option v-for="p in places" :key="p.environmentId" :value="p.environmentId">{{ p.label }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="clone-server">Servidor</label>
            <select id="clone-server" v-model="cloneServer" class="form-control">
              <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-secondary" :disabled="busy || !cloneName.trim()">Clonar aplicação</button>
      </div>
    </form>

    <form class="card" style="margin-bottom: 0" @submit.prevent="move">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">drive_file_move</span>
        Mover pra outro ambiente
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          Só muda onde a aplicação aparece (projeto/ambiente) — o container continua rodando. Atenção: referências a variáveis compartilhadas de
          <span class="mono">project</span> ou <span class="mono">environment</span> passam a apontar pro novo local no próximo deploy.
        </p>
        <div class="form-group">
          <label for="move-env">Destino</label>
          <select id="move-env" v-model="moveEnv" class="form-control">
            <option value="">Escolha um ambiente</option>
            <option v-for="p in places.filter((x) => x.environmentId !== app!.environmentId)" :key="p.environmentId" :value="p.environmentId">{{ p.label }}</option>
          </select>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn btn-secondary" :disabled="busy || !moveEnv">Mover</button>
          <span v-if="message" class="muted" style="align-self: center; font-size: 13px">{{ message }}</span>
        </div>
      </div>
    </form>
  </div>
</template>
