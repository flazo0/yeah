<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
import { api, ApiError, postConfirmingOverload } from "../lib/api";
import Breadcrumb from "../components/Breadcrumb.vue";
import Modal from "../components/Modal.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const projectId = route.params.projectId as string;
const environmentId = route.params.environmentId as string;
const basePath = `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

type Category = "application" | "database" | "service";

interface CatalogCard {
  id: string;
  category: Category;
  name: string;
  subtitle: string;
  description: string;
  icon: string;
  website?: string;
  docsUrl?: string;
}

const teamServers = ref<ServerDto[]>([]);
const serverId = ref("");
const loading = ref(true);
const error = ref("");
const search = ref("");
const categoryFilter = ref<"" | Category>("");
const creatingId = ref<string | null>(null);

const githubConnected = ref(false);
const githubRepos = ref<GithubRepoDto[]>([]);

const cards = computed<CatalogCard[]>(() => [
  {
    id: "app-public",
    category: "application",
    name: "Repositório Git público",
    subtitle: "Origem Git",
    description: "Deploy de qualquer repositório público a partir do Dockerfile, sem credenciais.",
    icon: "source",
    docsUrl: "https://docs.docker.com/reference/dockerfile/",
  },
  {
    id: "app-github",
    category: "application",
    name: "Repositório do GitHub (GitHub App)",
    subtitle: "Origem Git",
    description: "Repositórios públicos ou privados da sua conta pelo GitHub App, com auto-deploy a cada push.",
    icon: "hub",
  },
  {
    id: "app-deploykey",
    category: "application",
    name: "Repositório privado (Deploy Key)",
    subtitle: "Origem Git · SSH",
    description: "Qualquer Git por SSH (GitHub, GitLab, Gitea, servidor próprio). O yeah gera uma chave só pra esse repositório e mostra a pública pra você cadastrar.",
    icon: "key",
  },
  {
    id: "app-nixpacks",
    category: "application",
    name: "Nixpacks",
    subtitle: "Build pack · Git",
    description: "Sem Dockerfile: o Nixpacks detecta a linguagem (Node, Python, Go, PHP...) e monta a imagem. Instalado no servidor na primeira vez.",
    icon: "auto_fix_high",
    docsUrl: "https://nixpacks.com/docs",
  },
  {
    id: "app-static",
    category: "application",
    name: "Site estático",
    subtitle: "Build pack · Git",
    description: "Serve uma pasta do repositório (HTML, ou a saída já buildada do seu front) com nginx.",
    icon: "web",
  },
  {
    id: "app-image",
    category: "application",
    name: "Docker Image",
    subtitle: "Imagem pronta",
    description: "Roda uma imagem de qualquer registry público, sem Git e sem build.",
    icon: "deployed_code_history",
    docsUrl: "https://docs.docker.com/reference/cli/docker/image/pull/",
  },
  {
    id: "app-inline",
    category: "application",
    name: "Dockerfile",
    subtitle: "Dockerfile colado",
    description: "Cole um Dockerfile aqui e o yeah builda no servidor — sem repositório.",
    icon: "description",
    docsUrl: "https://docs.docker.com/reference/dockerfile/",
  },
  ...(Object.entries(DATABASE_ENGINES) as [DatabaseEngine, (typeof DATABASE_ENGINES)[DatabaseEngine]][]).map(
    ([key, info]) => ({
      id: `db-${key}`,
      category: "database" as const,
      name: info.label,
      subtitle: info.defaultImage,
      description: info.description,
      icon: info.icon,
      website: info.website,
      docsUrl: info.docsUrl,
    }),
  ),
  ...SERVICE_CATALOG.map((entry) => ({
    id: `svc-${entry.key}`,
    category: "service" as const,
    name: entry.name,
    subtitle: entry.image,
    description: entry.description,
    icon: entry.icon,
    website: entry.website,
    docsUrl: entry.docsUrl,
  })),
]);

const visibleCards = computed(() => {
  const q = search.value.trim().toLowerCase();
  return cards.value.filter(
    (c) => (!categoryFilter.value || c.category === categoryFilter.value) && (!q || `${c.name} ${c.description} ${c.subtitle}`.toLowerCase().includes(q)),
  );
});

const sections: { category: Category; title: string; icon: string }[] = [
  { category: "application", title: "Aplicações", icon: "deployed_code" },
  { category: "database", title: "Bancos de dados", icon: "database" },
  { category: "service", title: "Serviços", icon: "widgets" },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`);
    teamServers.value = res.servers;
    serverId.value = (res.servers.find((s) => s.status === "connected") ?? res.servers[0])?.id ?? "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar servidores";
  } finally {
    loading.value = false;
  }
}

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

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

// Database and service cards create the resource right away with the catalog's defaults and land
// on its configuration page — nothing to fill in first, same as Coolify's one-click flow.
async function deployDatabase(engine: DatabaseEngine) {
  const info = DATABASE_ENGINES[engine];
  const res = await postConfirmingOverload<{ database: DatabaseDto }>(`${basePath}/databases`, {
    name: `${engine}-${suffix()}`,
    serverId: serverId.value,
    engine,
    username: info.hasUsername ? "app" : undefined,
    databaseName: info.hasDatabaseName ? "app" : undefined,
    port: info.defaultPort,
  });
  router.push(`${basePath}/databases/${res.database.id}`);
}

async function deployService(catalogKey: string) {
  const res = await postConfirmingOverload<{ service: ServiceDto }>(`${basePath}/services`, {
    name: `${catalogKey}-${suffix()}`,
    serverId: serverId.value,
    catalogKey,
  });
  router.push(`${basePath}/services/${res.service.id}`);
}

type AppMode = "public" | "github" | "deploykey" | "nixpacks" | "static" | "image" | "inline";
const appModal = ref<AppMode | null>(null);
const appForm = ref({
  name: "",
  repoUrl: "",
  githubRepo: "",
  branch: "main",
  port: 3000,
  dockerImage: "",
  dockerfileContent: "FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD [\"node\", \"index.js\"]\n",
  publishDirectory: ".",
});
const appModalTitles: Record<AppMode, string> = {
  public: "Repositório Git público",
  github: "Repositório do GitHub",
  deploykey: "Repositório privado (Deploy Key)",
  nixpacks: "Nixpacks",
  static: "Site estático",
  image: "Docker Image",
  inline: "Dockerfile",
};
const modeUsesRepo = (mode: AppMode | null) => mode === "public" || mode === "deploykey" || mode === "nixpacks" || mode === "static";
const submittingApp = ref(false);

function onGithubRepoChange() {
  const repo = githubRepos.value.find((r) => r.fullName === appForm.value.githubRepo);
  if (repo) appForm.value.branch = repo.defaultBranch;
}

async function createApp() {
  submittingApp.value = true;
  error.value = "";
  try {
    const mode = appModal.value!;
    const f = appForm.value;
    const base = { name: f.name, serverId: serverId.value, port: f.port };
    let payload: Record<string, unknown>;
    if (mode === "github") payload = { ...base, branch: f.branch, githubRepo: f.githubRepo };
    else if (mode === "public") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl };
    else if (mode === "deploykey") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, useDeployKey: true };
    else if (mode === "nixpacks") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, buildPack: "nixpacks" };
    else if (mode === "static") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, buildPack: "static", publishDirectory: f.publishDirectory };
    else if (mode === "image") payload = { ...base, buildPack: "image", dockerImage: f.dockerImage };
    else payload = { ...base, buildPack: "dockerfile_inline", dockerfileContent: f.dockerfileContent };
    const res = await api.post<{ application: ApplicationDto }>(`${basePath}/applications`, payload);
    // A deploy key still has to be registered on the repository — land on the page that shows it.
    router.push(`${basePath}/apps/${res.application.id}${mode === "deploykey" ? "/general" : ""}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar aplicação";
  } finally {
    submittingApp.value = false;
  }
}

async function deploy(card: CatalogCard) {
  error.value = "";
  const modeByCard: Record<string, AppMode> = {
    "app-public": "public",
    "app-deploykey": "deploykey",
    "app-nixpacks": "nixpacks",
    "app-static": "static",
    "app-image": "image",
    "app-inline": "inline",
  };
  const mode = modeByCard[card.id];
  if (mode) {
    appForm.value.port = mode === "static" ? 80 : 3000;
    appModal.value = mode;
    return;
  }
  if (card.id === "app-github") {
    if (!githubConnected.value) {
      router.push(`/teams/${teamId}/sources`);
      return;
    }
    appModal.value = "github";
    return;
  }
  creatingId.value = card.id;
  try {
    if (card.id.startsWith("db-")) await deployDatabase(card.id.slice(3) as DatabaseEngine);
    else await deployService(card.id.slice(4));
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar recurso";
    creatingId.value = null;
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
        <h1>Escolha um recurso</h1>
        <p>Bancos e serviços são criados na hora com os valores padrão; você ajusta na tela do recurso.</p>
      </div>
    </div>

    <div v-if="error && !appModal" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!loading && teamServers.length === 0" class="card">
      <div class="card-body">
        <div class="empty-state">
          Você precisa de um <RouterLink :to="`/teams/${teamId}/servers/new`" class="label-link">servidor conectado</RouterLink>
          antes de criar recursos.
        </div>
      </div>
    </div>

    <template v-else>
      <div class="rtable-toolbar">
        <div class="rtable-search input-icon">
          <span class="material-symbols-outlined">search</span>
          <input v-model="search" class="form-control" type="search" placeholder="Buscar recursos" aria-label="Buscar recursos" />
        </div>
        <div class="rtable-filters">
          <select v-model="categoryFilter" class="form-control" aria-label="Categoria">
            <option value="">Todas as categorias</option>
            <option value="application">Aplicações</option>
            <option value="database">Bancos de dados</option>
            <option value="service">Serviços</option>
          </select>
          <select v-model="serverId" class="form-control" aria-label="Servidor de destino">
            <option v-for="s in teamServers" :key="s.id" :value="s.id">Servidor: {{ s.name }}</option>
          </select>
        </div>
      </div>

      <div v-if="visibleCards.length === 0" class="empty-state">Nada bate com a busca.</div>

      <template v-for="section in sections" :key="section.category">
        <div v-if="visibleCards.some((c) => c.category === section.category)" class="card mb-16">
          <div class="card-header">
            <span class="material-symbols-outlined" style="font-size: 18px">{{ section.icon }}</span>
            {{ section.title }}
          </div>
          <div class="card-body">
            <p v-if="section.category === 'service'" class="hint mb-16">
              As marcas citadas pertencem às respectivas empresas; a listagem não indica afiliação nem endosso.
            </p>
            <div class="catalog-grid">
              <div v-for="card in visibleCards.filter((c) => c.category === section.category)" :key="card.id" class="catalog-card">
                <div class="catalog-card-head">
                  <span class="rtable-icon"><span class="material-symbols-outlined">{{ card.icon }}</span></span>
                  <div class="rtable-name-text">
                    <strong>{{ card.name }}</strong>
                    <small class="muted mono">{{ card.subtitle }}</small>
                  </div>
                </div>
                <p class="catalog-card-desc">{{ card.description }}</p>
                <div class="catalog-card-actions">
                  <a v-if="card.docsUrl" :href="card.docsUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Docs</a>
                  <a v-if="card.website" :href="card.website" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Website</a>
                  <button type="button" class="btn btn-sm catalog-deploy" :disabled="creatingId !== null" @click="deploy(card)">
                    {{ creatingId === card.id ? "criando..." : "Deploy" }}
                    <span class="material-symbols-outlined" style="font-size: 16px">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <Modal v-if="appModal" :title="appModalTitles[appModal]" @close="appModal = null">
      <form @submit.prevent="createApp">
        <div class="form-group">
          <label for="app-name">Nome</label>
          <input id="app-name" v-model="appForm.name" class="form-control" placeholder="minha-api" required />
        </div>

        <div v-if="appModal === 'github'" class="form-group">
          <label for="app-github-repo">Repositório</label>
          <select id="app-github-repo" v-model="appForm.githubRepo" class="form-control" required @change="onGithubRepoChange">
            <option value="" disabled>selecione...</option>
            <option v-for="repo in githubRepos" :key="repo.fullName" :value="repo.fullName">
              {{ repo.fullName }}{{ repo.private ? " (privado)" : "" }}
            </option>
          </select>
        </div>
        <div v-else-if="modeUsesRepo(appModal)" class="form-group">
          <label for="app-repo">URL do repositório</label>
          <input
            id="app-repo"
            v-model="appForm.repoUrl"
            class="form-control mono"
            :placeholder="appModal === 'deploykey' ? 'git@github.com:org/repo.git' : 'https://github.com/...'"
            required
          />
          <p v-if="appModal === 'deploykey'" class="hint" style="margin-top: 6px">
            Use a URL SSH. Depois de criar, o yeah mostra a chave pública pra você cadastrar no repositório como deploy key (só leitura).
          </p>
        </div>

        <div v-if="appModal === 'image'" class="form-group">
          <label for="app-image">Imagem</label>
          <input id="app-image" v-model="appForm.dockerImage" class="form-control mono" placeholder="nginx:1.27-alpine" required />
        </div>
        <div v-if="appModal === 'inline'" class="form-group">
          <label for="app-dockerfile">Dockerfile</label>
          <textarea id="app-dockerfile" v-model="appForm.dockerfileContent" class="form-control mono" rows="9" required></textarea>
        </div>
        <div v-if="appModal === 'static'" class="form-group">
          <label for="app-publish">Pasta a publicar</label>
          <input id="app-publish" v-model="appForm.publishDirectory" class="form-control mono" placeholder="dist" />
          <p class="hint" style="margin-top: 6px">Relativa à raiz do repositório (`.` = a raiz). O repositório precisa já ter os arquivos prontos nessa pasta.</p>
        </div>

        <div class="form-row mb-16">
          <div v-if="modeUsesRepo(appModal) || appModal === 'github'" class="form-group" style="margin-bottom: 0">
            <label for="app-branch">Branch</label>
            <input id="app-branch" v-model="appForm.branch" class="form-control" placeholder="main" />
          </div>
          <div v-if="appModal !== 'static'" class="form-group" style="margin-bottom: 0">
            <label for="app-port">Porta do app</label>
            <input id="app-port" v-model.number="appForm.port" type="number" class="form-control" />
          </div>
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="submittingApp">{{ submittingApp ? "criando..." : "Criar aplicação" }}</button>
          <button type="button" class="btn btn-secondary" @click="appModal = null">Cancelar</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
