<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  DATABASE_ENGINES,
  type ApplicationDto,
  type ApplicationStatus,
  type DatabaseDto,
  type DatabaseEngine,
  type DatabaseStatus,
  type GithubRepoDto,
  type ServerDto,
  type WsServerEvent,
} from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";

const route = useRoute();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

const apps = ref<ApplicationDto[]>([]);
const dbs = ref<DatabaseDto[]>([]);
const teamServers = ref<ServerDto[]>([]);
const loading = ref(true);
const error = ref("");

const appForm = ref({ name: "", serverId: "", repoUrl: "", githubRepo: "", branch: "main", port: 3000 });
const appSourceMode = ref<"url" | "github">("url");
const githubRepos = ref<GithubRepoDto[]>([]);
const githubConnected = ref(false);

async function loadGithub() {
  try {
    const res = await api.get<{ configured: boolean; installation: unknown }>(`/teams/${teamId}/github`);
    githubConnected.value = res.configured && res.installation !== null;
    if (githubConnected.value) {
      const reposRes = await api.get<{ repos: GithubRepoDto[] }>(`/teams/${teamId}/github/repos`);
      githubRepos.value = reposRes.repos;
    }
  } catch {
    githubConnected.value = false;
  }
}

function onGithubRepoChange() {
  const repo = githubRepos.value.find((r) => r.fullName === appForm.value.githubRepo);
  if (repo) appForm.value.branch = repo.defaultBranch;
}
const dbForm = ref({
  name: "",
  serverId: "",
  engine: "postgresql" as DatabaseEngine,
  username: "app",
  databaseName: "app",
  port: DATABASE_ENGINES.postgresql.defaultPort,
});
const submittingApp = ref(false);
const submittingDb = ref(false);
const databaseEngineOptions = Object.entries(DATABASE_ENGINES) as [DatabaseEngine, (typeof DATABASE_ENGINES)[DatabaseEngine]][];

function onEngineChange() {
  dbForm.value.port = DATABASE_ENGINES[dbForm.value.engine].defaultPort;
}

const appStatusBadge: Record<ApplicationStatus, string> = {
  idle: "badge-neutral",
  deploying: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};
const dbStatusBadge: Record<DatabaseStatus, string> = {
  idle: "badge-neutral",
  provisioning: "badge-warn",
  running: "badge-good",
  error: "badge-bad",
};
const appStatusDot: Record<ApplicationStatus, string> = {
  idle: "status-dot-neutral",
  deploying: "status-dot-warn",
  running: "status-dot-good",
  error: "status-dot-bad",
};
const dbStatusDot: Record<DatabaseStatus, string> = {
  idle: "status-dot-neutral",
  provisioning: "status-dot-warn",
  running: "status-dot-good",
  error: "status-dot-bad",
};

async function load() {
  loading.value = true;
  try {
    const [appsRes, dbsRes, serversRes] = await Promise.all([
      api.get<{ applications: ApplicationDto[] }>(`${basePath}/applications`),
      api.get<{ databases: DatabaseDto[] }>(`${basePath}/databases`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
    ]);
    apps.value = appsRes.applications;
    dbs.value = dbsRes.databases;
    teamServers.value = serversRes.servers;
    if (teamServers.value[0]) {
      if (!appForm.value.serverId) appForm.value.serverId = teamServers.value[0].id;
      if (!dbForm.value.serverId) dbForm.value.serverId = teamServers.value[0].id;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar o ambiente";
  } finally {
    loading.value = false;
  }
}

async function createApp() {
  submittingApp.value = true;
  error.value = "";
  try {
    const payload =
      appSourceMode.value === "github"
        ? { name: appForm.value.name, serverId: appForm.value.serverId, githubRepo: appForm.value.githubRepo, branch: appForm.value.branch, port: appForm.value.port }
        : { name: appForm.value.name, serverId: appForm.value.serverId, repoUrl: appForm.value.repoUrl, branch: appForm.value.branch, port: appForm.value.port };
    const res = await api.post<{ application: ApplicationDto }>(`${basePath}/applications`, payload);
    apps.value.push(res.application);
    appForm.value = { name: "", serverId: appForm.value.serverId, repoUrl: "", githubRepo: "", branch: "main", port: 3000 };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar aplicação";
  } finally {
    submittingApp.value = false;
  }
}

async function createDb() {
  submittingDb.value = true;
  error.value = "";
  try {
    const res = await api.post<{ database: DatabaseDto }>(`${basePath}/databases`, dbForm.value);
    dbs.value.push(res.database);
    dbForm.value = {
      name: "",
      serverId: dbForm.value.serverId,
      engine: "postgresql",
      username: "app",
      databaseName: "app",
      port: DATABASE_ENGINES.postgresql.defaultPort,
    };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar banco de dados";
  } finally {
    submittingDb.value = false;
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

async function deleteApp(app: ApplicationDto) {
  if (pendingDeleteId.value !== app.id) {
    armDelete(app.id);
    return;
  }
  pendingDeleteId.value = null;
  clearTimeout(pendingDeleteTimer);
  try {
    await api.delete(`${basePath}/applications/${app.id}`);
    apps.value = apps.value.filter((a) => a.id !== app.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir aplicação";
  }
}

async function deleteDb(item: DatabaseDto) {
  if (pendingDeleteId.value !== item.id) {
    armDelete(item.id);
    return;
  }
  pendingDeleteId.value = null;
  clearTimeout(pendingDeleteTimer);
  try {
    await api.delete(`${basePath}/databases/${item.id}`);
    dbs.value = dbs.value.filter((d) => d.id !== item.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir banco de dados";
  }
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  load();
  loadGithub();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "database.status") {
      const database = dbs.value.find((d) => d.id === event.databaseId);
      if (database) database.status = event.status;
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
    <div class="page-header">
      <div>
        <h1>Recursos</h1>
        <p>Aplicações e bancos de dados deste ambiente.</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">deployed_code</span>
        Aplicações
      </div>
      <div v-if="loading" class="card-body"><div class="empty-state">carregando...</div></div>
      <div v-else-if="apps.length === 0" class="card-body">
        <div class="empty-state">Nenhuma aplicação ainda.</div>
      </div>
      <div v-else class="card-body">
        <div class="resource-cards">
          <div v-for="app in apps" :key="app.id" class="resource-card-wrap">
            <RouterLink :to="`${basePath}/apps/${app.id}`" class="resource-card">
              <div class="name">
                <span class="status-dot" :class="appStatusDot[app.status]"></span>
                {{ app.name }}
                <span class="badge" :class="appStatusBadge[app.status]" style="margin-left: auto">{{ app.status }}</span>
              </div>
              <div class="desc mono">{{ app.repoUrl }} ({{ app.branch }})</div>
              <div class="desc">{{ app.serverName }}</div>
            </RouterLink>
            <button
              type="button"
              class="resource-card-delete"
              :class="{ confirming: pendingDeleteId === app.id }"
              :title="pendingDeleteId === app.id ? 'Clique de novo pra confirmar' : 'Excluir'"
              @click="deleteApp(app)"
            >
              <span class="material-symbols-outlined">{{ pendingDeleteId === app.id ? "warning" : "delete" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">database</span>
        Bancos de dados
      </div>
      <div v-if="loading" class="card-body"><div class="empty-state">carregando...</div></div>
      <div v-else-if="dbs.length === 0" class="card-body">
        <div class="empty-state">Nenhum banco de dados ainda.</div>
      </div>
      <div v-else class="card-body">
        <div class="resource-cards">
          <div v-for="item in dbs" :key="item.id" class="resource-card-wrap">
            <RouterLink :to="`${basePath}/databases/${item.id}`" class="resource-card">
              <div class="name">
                <span class="status-dot" :class="dbStatusDot[item.status]"></span>
                {{ item.name }}
                <span class="badge" :class="dbStatusBadge[item.status]" style="margin-left: auto">{{ item.status }}</span>
              </div>
              <div class="desc mono">{{ item.engine }} · {{ item.image }}</div>
              <div class="desc">{{ item.serverName }}</div>
            </RouterLink>
            <button
              type="button"
              class="resource-card-delete"
              :class="{ confirming: pendingDeleteId === item.id }"
              :title="pendingDeleteId === item.id ? 'Clique de novo pra confirmar' : 'Excluir'"
              @click="deleteDb(item)"
            >
              <span class="material-symbols-outlined">{{ pendingDeleteId === item.id ? "warning" : "delete" }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="teamServers.length === 0" class="card">
      <div class="card-body">
        <div class="empty-state">
          Você precisa de um <RouterLink :to="`/teams/${teamId}/servers`" class="label-link">servidor conectado</RouterLink>
          antes de criar aplicações ou bancos de dados.
        </div>
      </div>
    </div>

    <div v-else class="grid grid-2">
      <div class="card" style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          Nova aplicação
        </div>
        <div class="card-body">
          <form @submit.prevent="createApp">
            <div class="form-group">
              <label for="app-name">Nome</label>
              <input id="app-name" v-model="appForm.name" class="form-control" placeholder="minha-api" required />
            </div>
            <div class="form-group">
              <label for="app-server">Servidor</label>
              <select id="app-server" v-model="appForm.serverId" class="form-control" required>
                <option v-for="s in teamServers" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="app-branch">Branch</label>
                <input id="app-branch" v-model="appForm.branch" class="form-control" placeholder="main" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="app-port">Porta</label>
                <input id="app-port" v-model.number="appForm.port" type="number" class="form-control" />
              </div>
            </div>
            <div v-if="githubConnected" class="form-group">
              <div class="btn-row mb-16">
                <button type="button" class="btn btn-secondary btn-sm" :class="{ active: appSourceMode === 'url' }" @click="appSourceMode = 'url'">
                  URL manual
                </button>
                <button type="button" class="btn btn-secondary btn-sm" :class="{ active: appSourceMode === 'github' }" @click="appSourceMode = 'github'">
                  <span class="material-symbols-outlined" style="font-size: 16px">hub</span>
                  Repositório do GitHub
                </button>
              </div>
            </div>
            <div v-if="appSourceMode === 'github' && githubConnected" class="form-group">
              <label for="app-github-repo">Repositório</label>
              <select id="app-github-repo" v-model="appForm.githubRepo" class="form-control" required @change="onGithubRepoChange">
                <option value="" disabled>selecione...</option>
                <option v-for="repo in githubRepos" :key="repo.fullName" :value="repo.fullName">
                  {{ repo.fullName }}{{ repo.private ? " (privado)" : "" }}
                </option>
              </select>
            </div>
            <div v-else class="form-group">
              <label for="app-repo">URL do repositório</label>
              <input id="app-repo" v-model="appForm.repoUrl" class="form-control" placeholder="https://github.com/..." required />
            </div>
            <button type="submit" class="btn" :disabled="submittingApp">
              {{ submittingApp ? "criando..." : "Criar aplicação" }}
            </button>
          </form>
        </div>
      </div>

      <div class="card" style="margin-bottom: 0">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          Novo banco de dados
        </div>
        <div class="card-body">
          <form @submit.prevent="createDb">
            <div class="form-group">
              <label for="db-name">Nome</label>
              <input id="db-name" v-model="dbForm.name" class="form-control" placeholder="meu-postgres" required />
            </div>
            <div class="form-group">
              <label for="db-server">Servidor</label>
              <select id="db-server" v-model="dbForm.serverId" class="form-control" required>
                <option v-for="s in teamServers" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label for="db-engine">Motor</label>
              <select id="db-engine" v-model="dbForm.engine" class="form-control" @change="onEngineChange">
                <option v-for="[value, info] in databaseEngineOptions" :key="value" :value="value">{{ info.label }}</option>
              </select>
            </div>
            <div class="form-row mb-16">
              <div v-if="DATABASE_ENGINES[dbForm.engine].hasUsername" class="form-group" style="margin-bottom: 0">
                <label for="db-username">Usuário</label>
                <input id="db-username" v-model="dbForm.username" class="form-control" />
              </div>
              <div v-if="DATABASE_ENGINES[dbForm.engine].hasDatabaseName" class="form-group" style="margin-bottom: 0">
                <label for="db-database">Database</label>
                <input id="db-database" v-model="dbForm.databaseName" class="form-control" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="db-port">Porta</label>
                <input id="db-port" v-model.number="dbForm.port" type="number" class="form-control" />
              </div>
            </div>
            <button type="submit" class="btn" :disabled="submittingDb">
              {{ submittingDb ? "criando..." : "Criar banco de dados" }}
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
