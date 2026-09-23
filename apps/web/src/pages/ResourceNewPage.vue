<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DATABASE_ENGINES,
  SERVICE_CATALOG,
  type ApplicationDto,
  type DatabaseDto,
  type DatabaseEngine,
  type GithubRepoDto,
  type ServerDto,
  type ServiceDto,
} from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import Breadcrumb from "../components/Breadcrumb.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;
const environmentPath = basePath;

type ResourceKind = "application" | "database" | "service";
const kind = ref<ResourceKind | null>(null);

const teamServers = ref<ServerDto[]>([]);
const loading = ref(true);
const error = ref("");

const appForm = ref({
  name: "",
  serverId: "",
  repoUrl: "",
  githubRepo: "",
  branch: "main",
  port: 3000,
  memoryLimitMb: null as number | null,
  cpuLimit: null as number | null,
});
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
  memoryLimitMb: null as number | null,
  cpuLimit: null as number | null,
});
const svcForm = ref({
  name: "",
  serverId: "",
  catalogKey: SERVICE_CATALOG[0]!.key,
  memoryLimitMb: null as number | null,
  cpuLimit: null as number | null,
});
const submitting = ref(false);
const databaseEngineOptions = Object.entries(DATABASE_ENGINES) as [DatabaseEngine, (typeof DATABASE_ENGINES)[DatabaseEngine]][];

function onEngineChange() {
  dbForm.value.port = DATABASE_ENGINES[dbForm.value.engine].defaultPort;
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`);
    teamServers.value = res.servers;
    if (teamServers.value[0]) {
      appForm.value.serverId = teamServers.value[0].id;
      dbForm.value.serverId = teamServers.value[0].id;
      svcForm.value.serverId = teamServers.value[0].id;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar servidores";
  } finally {
    loading.value = false;
  }
}

async function createApp() {
  submitting.value = true;
  error.value = "";
  try {
    const payload =
      appSourceMode.value === "github"
        ? { name: appForm.value.name, serverId: appForm.value.serverId, githubRepo: appForm.value.githubRepo, branch: appForm.value.branch, port: appForm.value.port }
        : { name: appForm.value.name, serverId: appForm.value.serverId, repoUrl: appForm.value.repoUrl, branch: appForm.value.branch, port: appForm.value.port };
    const res = await api.post<{ application: ApplicationDto }>(`${basePath}/applications`, {
      ...payload,
      memoryLimitMb: appForm.value.memoryLimitMb || null,
      cpuLimit: appForm.value.cpuLimit || null,
    });
    router.push(`${basePath}/apps/${res.application.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar aplicação";
  } finally {
    submitting.value = false;
  }
}

async function createDb() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ database: DatabaseDto }>(`${basePath}/databases`, {
      ...dbForm.value,
      memoryLimitMb: dbForm.value.memoryLimitMb || null,
      cpuLimit: dbForm.value.cpuLimit || null,
    });
    router.push(`${basePath}/databases/${res.database.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar banco de dados";
  } finally {
    submitting.value = false;
  }
}

async function createService() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ service: ServiceDto }>(`${basePath}/services`, {
      ...svcForm.value,
      memoryLimitMb: svcForm.value.memoryLimitMb || null,
      cpuLimit: svcForm.value.cpuLimit || null,
    });
    router.push(`${basePath}/services/${res.service.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar serviço";
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  load();
  loadGithub();
});
</script>

<template>
  <div>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" current="Novo recurso" />
    <div class="page-header">
      <div>
        <h1>Novo recurso</h1>
        <p>Escolha o que criar neste ambiente.</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!loading && teamServers.length === 0" class="card">
      <div class="card-body">
        <div class="empty-state">
          Você precisa de um <RouterLink :to="`/teams/${teamId}/servers`" class="label-link">servidor conectado</RouterLink>
          antes de criar recursos.
        </div>
      </div>
    </div>

    <template v-else>
      <div class="resource-kind-picker mb-16">
        <button type="button" class="resource-kind-tile" :class="{ active: kind === 'application' }" @click="kind = 'application'">
          <span class="material-symbols-outlined">deployed_code</span>
          <div>
            <div class="name">Aplicação</div>
            <div class="desc">Deploy a partir de um repositório Git (Dockerfile)</div>
          </div>
        </button>
        <button type="button" class="resource-kind-tile" :class="{ active: kind === 'database' }" @click="kind = 'database'">
          <span class="material-symbols-outlined">database</span>
          <div>
            <div class="name">Banco de dados</div>
            <div class="desc">PostgreSQL, MySQL, MariaDB, Redis ou MongoDB</div>
          </div>
        </button>
        <button type="button" class="resource-kind-tile" :class="{ active: kind === 'service' }" @click="kind = 'service'">
          <span class="material-symbols-outlined">widgets</span>
          <div>
            <div class="name">Serviço</div>
            <div class="desc">Catálogo um-clique — Uptime Kuma, n8n, MinIO e mais</div>
          </div>
        </button>
      </div>

      <div v-if="kind === 'application'" class="card">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">deployed_code</span>
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
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="app-mem">Limite de memória (MB)</label>
                <input id="app-mem" v-model.number="appForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="app-cpu">Limite de CPU (cores)</label>
                <input id="app-cpu" v-model.number="appForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
              </div>
            </div>
            <button type="submit" class="btn" :disabled="submitting">
              {{ submitting ? "criando..." : "Criar aplicação" }}
            </button>
          </form>
        </div>
      </div>

      <div v-else-if="kind === 'database'" class="card">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">database</span>
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
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="db-mem">Limite de memória (MB)</label>
                <input id="db-mem" v-model.number="dbForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="db-cpu">Limite de CPU (cores)</label>
                <input id="db-cpu" v-model.number="dbForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
              </div>
            </div>
            <button type="submit" class="btn" :disabled="submitting">
              {{ submitting ? "criando..." : "Criar banco de dados" }}
            </button>
          </form>
        </div>
      </div>

      <div v-else-if="kind === 'service'" class="card">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">widgets</span>
          Novo serviço
        </div>
        <div class="card-body">
          <form @submit.prevent="createService">
            <div class="form-group">
              <label for="svc-name">Nome</label>
              <input id="svc-name" v-model="svcForm.name" class="form-control" placeholder="meu-uptime-kuma" required />
            </div>
            <div class="form-group">
              <label for="svc-server">Servidor</label>
              <select id="svc-server" v-model="svcForm.serverId" class="form-control" required>
                <option v-for="s in teamServers" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="form-group">
              <label for="svc-catalog">Serviço</label>
              <select id="svc-catalog" v-model="svcForm.catalogKey" class="form-control">
                <option v-for="entry in SERVICE_CATALOG" :key="entry.key" :value="entry.key">{{ entry.name }}</option>
              </select>
              <p class="hint" style="margin-top: 6px">
                {{ SERVICE_CATALOG.find((e) => e.key === svcForm.catalogKey)?.description }}
              </p>
            </div>
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="svc-mem">Limite de memória (MB)</label>
                <input id="svc-mem" v-model.number="svcForm.memoryLimitMb" type="number" min="0" class="form-control" placeholder="sem limite" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="svc-cpu">Limite de CPU (cores)</label>
                <input id="svc-cpu" v-model.number="svcForm.cpuLimit" type="number" min="0" step="0.1" class="form-control" placeholder="sem limite" />
              </div>
            </div>
            <button type="submit" class="btn" :disabled="submitting">
              {{ submitting ? "criando..." : "Criar serviço" }}
            </button>
          </form>
        </div>
      </div>
    </template>
  </div>
</template>
