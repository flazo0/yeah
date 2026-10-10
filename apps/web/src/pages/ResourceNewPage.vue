<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  DATABASE_ENGINES,
  type ApplicationDto,
  type DatabaseDto,
  type DatabaseEngine,
  type GithubRepoDto,
  type GitRepoDto,
  type GitSourceDto,
  type ServerDto,
  type ServiceTemplateDto,
  type ServiceDto,
  type SshKeyDto,
} from "@yeah/shared";
import { api, ApiError, postConfirmingOverload } from "../lib/api";
import Breadcrumb from "../components/Breadcrumb.vue";
import Modal from "../components/Modal.vue";
import { i18n } from "../lib/i18n";

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
  /** Templates only: the sub-category used by the service filter. */
  serviceCategory?: string;
}

const teamServers = ref<ServerDto[]>([]);
const serverId = ref("");
const loading = ref(true);
const error = ref("");
const templates = ref<ServiceTemplateDto[]>([]);
const serviceCategory = ref("");
const CATEGORY_LABELS: Record<string, string> = {
  monitoring: "Monitoramento", automation: i18n.global.t("resourceNew.automacao"), storage: "Arquivos", messaging: "Mensageria", search: "Busca", cms: i18n.global.t("resourceNew.cmsESites"),
  analytics: "Analytics", devops: "DevOps", database: i18n.global.t("resourceNew.bancoDeDados"), dev: "Dev", security: i18n.global.t("resourceNew.seguranca"), media: i18n.global.t("resourceNew.midia"), productivity: "Produtividade", other: "Outros",
};
const templateCategories = computed(() => [...new Set(templates.value.map((t) => t.category))].sort((a, b) => (CATEGORY_LABELS[a] ?? a).localeCompare(CATEGORY_LABELS[b] ?? b)));
const search = ref("");
const categoryFilter = ref<"" | Category>("");
const creatingId = ref<string | null>(null);

const githubConnected = ref(false);
const githubRepos = ref<GithubRepoDto[]>([]);

const cards = computed<CatalogCard[]>(() => [
  {
    id: "app-public",
    category: "application",
    name: i18n.global.t("resourceNew.repositorioGitPublico"),
    subtitle: "Origem Git",
    description: i18n.global.t("resourceNew.deployDeQualquerRepositorioPublico"),
    icon: "source",
    docsUrl: "https://docs.docker.com/reference/dockerfile/",
  },
  {
    id: "app-github",
    category: "application",
    name: i18n.global.t("resourceNew.repositorioDoGithubGithubApp"),
    subtitle: "Origem Git",
    description: i18n.global.t("resourceNew.repositoriosPublicosOuPrivadosDa"),
    icon: "hub",
  },
  {
    id: "app-gitsource",
    category: "application",
    name: i18n.global.t("resourceNew.repositorioDeUmaFonteGit"),
    subtitle: "GitLab · Bitbucket · Gitea",
    description: i18n.global.t("resourceNew.escolhaUmRepositorioDeUma"),
    icon: "merge",
  },
  {
    id: "app-deploykey",
    category: "application",
    name: i18n.global.t("resourceNew.repositorioPrivadoDeployKey"),
    subtitle: "Origem Git · SSH",
    description: i18n.global.t("resourceNew.qualquerGitPorSshGithub"),
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
    id: "app-railpack",
    category: "application",
    name: "Railpack",
    subtitle: "Build pack · Git",
    description: i18n.global.t("resourceNew.semDockerfileComoONixpacks"),
    icon: "bolt",
    docsUrl: "https://railpack.com/",
  },
  {
    id: "app-compose",
    category: "application",
    name: "Docker Compose",
    subtitle: "Stack · Git",
    description: i18n.global.t("resourceNew.umDockerComposeYmlDo"),
    icon: "stacks",
    docsUrl: "https://docs.docker.com/compose/",
  },
  {
    id: "app-static",
    category: "application",
    name: i18n.global.t("resourceNew.siteEstatico"),
    subtitle: "Build pack · Git",
    description: i18n.global.t("resourceNew.serveUmaPastaDoRepositorio"),
    icon: "web",
  },
  {
    id: "app-image",
    category: "application",
    name: "Docker Image",
    subtitle: "Imagem pronta",
    description: i18n.global.t("resourceNew.rodaUmaImagemDeQualquer"),
    icon: "deployed_code_history",
    docsUrl: "https://docs.docker.com/reference/cli/docker/image/pull/",
  },
  {
    id: "app-inline",
    category: "application",
    name: "Dockerfile",
    subtitle: "Dockerfile colado",
    description: i18n.global.t("resourceNew.coleUmDockerfileAquiE"),
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
  {
    id: "svc-custom",
    category: "service" as const,
    name: i18n.global.t("resourceNew.composeProprio"),
    subtitle: "Cole um docker-compose.yml",
    description: i18n.global.t("resourceNew.subaQualquerStackDeVarios"),
    icon: "edit_document",
    serviceCategory: "dev",
    docsUrl: "https://docs.docker.com/compose/",
  },
  ...templates.value.map((t) => ({
    id: `svc-${t.key}`,
    category: "service" as const,
    name: t.name,
    subtitle: `${t.services.length} container${t.services.length === 1 ? "" : "s"} · ${CATEGORY_LABELS[t.category] ?? t.category}`,
    description: t.description,
    icon: t.icon,
    serviceCategory: t.category,
    website: t.website,
    docsUrl: t.docsUrl,
  })),
]);

const visibleCards = computed(() => {
  const q = search.value.trim().toLowerCase();
  return cards.value.filter(
    (c) =>
      (!categoryFilter.value || c.category === categoryFilter.value) &&
      (!serviceCategory.value || c.category !== 'service' || c.serviceCategory === serviceCategory.value) &&
      (!q || `${c.name} ${c.description} ${c.subtitle}`.toLowerCase().includes(q)),
  );
});

const sections: { category: Category; title: string; icon: string }[] = [
  { category: "application", title: i18n.global.t("resourceNew.aplicacoes"), icon: "deployed_code" },
  { category: "database", title: i18n.global.t("resourceNew.bancosDeDados"), icon: "database" },
  { category: "service", title: i18n.global.t("resourceNew.servicos"), icon: "widgets" },
];

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`);
    teamServers.value = res.servers;
    serverId.value = (res.servers.find((s) => s.status === "connected") ?? res.servers[0])?.id ?? "";
    // "Local first": when the panel host is registered and healthy it is the default target — no extra step to try things on this machine.
    const local = res.servers.find((s) => s.isPlatformHost && s.status === "connected");
    if (local) serverId.value = local.id;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("resourceNew.falhaAoCarregarServidores");
  } finally {
    loading.value = false;
  }
}

async function loadTemplates() {
  try {
    templates.value = (await api.get<{ templates: ServiceTemplateDto[] }>(`/teams/${teamId}/service-templates`)).templates;
  } catch {
    templates.value = [];
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
  try {
    gitSourcesList.value = (await api.get<{ sources: GitSourceDto[] }>(`/teams/${teamId}/git-sources`)).sources;
  } catch {
    gitSourcesList.value = [];
  }
  try {
    sshKeysList.value = (await api.get<{ keys: SshKeyDto[] }>(`/teams/${teamId}/ssh-keys`)).keys;
  } catch {
    sshKeysList.value = [];
  }
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

// Database and service cards create the resource right away with the catalog's defaults and land
// on its configuration page — nothing to fill in first, same as Coolify's one-click flow.
// Databases ask for the version first (a database's major version is not something to guess).
const dbModal = ref<DatabaseEngine | null>(null);
const dbForm = ref({ name: "", version: "", customImage: "", publicAccess: false });
const submittingDb = ref(false);

function openDbModal(engine: DatabaseEngine) {
  const info = DATABASE_ENGINES[engine];
  dbForm.value = { name: `${engine}-${suffix()}`, version: info.versions.includes(info.defaultImage.split(":")[1] ?? "") ? (info.defaultImage.split(":")[1] ?? info.versions[0]!) : info.versions[0]!, customImage: "", publicAccess: false };
  dbModal.value = engine;
}

async function createDatabase() {
  const engine = dbModal.value!;
  const info = DATABASE_ENGINES[engine];
  submittingDb.value = true;
  error.value = "";
  try {
    const res = await postConfirmingOverload<{ database: DatabaseDto }>(`${basePath}/databases`, {
      name: dbForm.value.name,
      serverId: serverId.value,
      engine,
      ...(dbForm.value.customImage.trim() ? { image: dbForm.value.customImage.trim() } : { version: dbForm.value.version }),
      username: info.hasUsername ? "app" : undefined,
      databaseName: info.hasDatabaseName ? "app" : undefined,
      port: info.defaultPort,
      publicAccess: dbForm.value.publicAccess,
    });
    router.push(`${basePath}/databases/${res.database.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("resourceNew.falhaAoCriarOBanco");
  } finally {
    submittingDb.value = false;
  }
}

async function deployService(templateKey: string) {
  const res = await postConfirmingOverload<{ service: ServiceDto }>(`${basePath}/services`, {
    name: `${templateKey}-${suffix()}`,
    serverId: serverId.value,
    templateKey,
  });
  router.push(`${basePath}/services/${res.service.id}`);
}

// A pasted compose file: the same stack machinery, the user's own YAML.
const customModal = ref(false);
const customForm = ref({
  name: "",
  composeContent: "services:\n  web:\n    image: nginx:alpine\n    restart: unless-stopped\n",
  port: 80,
});
const submittingCustom = ref(false);

async function createCustomService() {
  submittingCustom.value = true;
  error.value = "";
  try {
    const res = await postConfirmingOverload<{ service: ServiceDto }>(`${basePath}/services`, {
      name: customForm.value.name,
      serverId: serverId.value,
      composeContent: customForm.value.composeContent,
      port: customForm.value.port,
    });
    router.push(`${basePath}/services/${res.service.id}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("resourceNew.falhaAoCriarOServico");
  } finally {
    submittingCustom.value = false;
  }
}

type AppMode = "public" | "github" | "gitsource" | "deploykey" | "nixpacks" | "railpack" | "compose" | "static" | "image" | "inline";
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
  composeFile: "docker-compose.yml",
  composeService: "",
  gitSourceId: "",
  gitRepo: "",
  deployKeySshKeyId: "",
});
const gitSourcesList = ref<GitSourceDto[]>([]);
const sshKeysList = ref<SshKeyDto[]>([]);
const gitRepos = ref<GitRepoDto[]>([]);
const loadingGitRepos = ref(false);

async function onGitSourceChange() {
  gitRepos.value = [];
  appForm.value.gitRepo = "";
  if (!appForm.value.gitSourceId) return;
  loadingGitRepos.value = true;
  try {
    gitRepos.value = (await api.get<{ repos: GitRepoDto[] }>(`/teams/${teamId}/git-sources/${appForm.value.gitSourceId}/repos`)).repos;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("resourceNew.falhaAoListarOsRepositorios");
  } finally {
    loadingGitRepos.value = false;
  }
}

function onGitRepoChange() {
  const repo = gitRepos.value.find((r) => r.fullName === appForm.value.gitRepo);
  if (repo) appForm.value.branch = repo.defaultBranch;
}
const appModalTitles: Record<AppMode, string> = {
  public: i18n.global.t("resourceNew.repositorioGitPublico"),
  github: i18n.global.t("resourceNew.repositorioDoGithub"),
  gitsource: "Fonte Git",
  deploykey: i18n.global.t("resourceNew.repositorioPrivadoDeployKey"),
  nixpacks: "Nixpacks",
  railpack: "Railpack",
  compose: "Docker Compose",
  static: i18n.global.t("resourceNew.siteEstatico"),
  image: "Docker Image",
  inline: "Dockerfile",
};
const modeUsesRepo = (mode: AppMode | null) => mode === "public" || mode === "gitsource" || mode === "deploykey" || mode === "nixpacks" || mode === "railpack" || mode === "compose" || mode === "static";
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
    else if (mode === "gitsource") payload = { ...base, branch: f.branch, gitSourceId: f.gitSourceId, gitRepo: f.gitRepo };
    else if (mode === "public") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl };
    else if (mode === "deploykey") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, ...(f.deployKeySshKeyId ? { deployKeySshKeyId: f.deployKeySshKeyId } : { useDeployKey: true }) };
    else if (mode === "nixpacks") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, buildPack: "nixpacks" };
    else if (mode === "railpack") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, buildPack: "railpack" };
    else if (mode === "compose") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, buildPack: "docker_compose", composeFile: f.composeFile, composeService: f.composeService };
    else if (mode === "static") payload = { ...base, branch: f.branch, repoUrl: f.repoUrl, buildPack: "static", publishDirectory: f.publishDirectory };
    else if (mode === "image") payload = { ...base, buildPack: "image", dockerImage: f.dockerImage };
    else payload = { ...base, buildPack: "dockerfile_inline", dockerfileContent: f.dockerfileContent };
    const res = await api.post<{ application: ApplicationDto }>(`${basePath}/applications`, payload);
    // A deploy key still has to be registered on the repository — land on the page that shows it.
    router.push(`${basePath}/apps/${res.application.id}${mode === "deploykey" ? "/general" : ""}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("resourceNew.falhaAoCriarAplicacao");
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
    "app-railpack": "railpack",
    "app-compose": "compose",
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
  if (card.id === "app-gitsource") {
    if (gitSourcesList.value.length === 0) {
      router.push(`/teams/${teamId}/sources`);
      return;
    }
    appModal.value = "gitsource";
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
    if (card.id.startsWith("db-")) {
      openDbModal(card.id.slice(3) as DatabaseEngine);
      creatingId.value = null;
      return;
    }
    if (card.id === "svc-custom") {
      customForm.value.name = `compose-${suffix()}`;
      customModal.value = true;
      creatingId.value = null;
      return;
    }
    await deployService(card.id.slice(4));
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("resourceNew.falhaAoCriarRecurso");
    creatingId.value = null;
  }
}

onMounted(() => {
  load();
  loadGithub();
  void loadTemplates();
});
</script>

<template>
  <div>
    <Breadcrumb :team-id="teamId" :project-id="projectId" :environment-id="environmentId" current="Novo recurso" />
    <div class="page-header">
      <div>
        <h1>{{ $t("resourceNew.escolhaUmRecurso") }}</h1>
        <p>{{ $t("resourceNew.servicosSaoCriadosNaHora") }}</p>
      </div>
    </div>

    <div v-if="error && !appModal" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!loading && teamServers.length === 0" class="card">
      <div class="card-body">
        <div class="empty-state">
          {{ $t("resourceNew.vocePrecisaDeUm") }} <RouterLink :to="`/teams/${teamId}/servers/new`" class="label-link">{{ $t("resourceNew.servidorConectado") }}</RouterLink>
          {{ $t("resourceNew.antesDeCriarRecursos") }}
        </div>
      </div>
    </div>

    <template v-else>
      <div class="rtable-toolbar">
        <div class="rtable-search input-icon">
          <span class="material-symbols-outlined">search</span>
          <input v-model="search" class="form-control" type="search" :placeholder="$t('resourceNew.buscarRecursos')" :aria-label="$t('resourceNew.buscarRecursos')" />
        </div>
        <div class="rtable-filters">
          <select v-model="categoryFilter" class="form-control" :aria-label="$t('resourceNew.categoria')">
            <option value="">{{ $t("resourceNew.todasAsCategorias") }}</option>
            <option value="application">{{ $t("resourceNew.aplicacoes") }}</option>
            <option value="database">{{ $t("resourceNew.bancosDeDados") }}</option>
            <option value="service">{{ $t("resourceNew.servicos") }}</option>
          </select>
          <select v-if="templateCategories.length && (categoryFilter === '' || categoryFilter === 'service')" v-model="serviceCategory" class="form-control" :aria-label="$t('resourceNew.tipoDeServico')">
            <option value="">{{ $t("resourceNew.todosOsTiposDeServico") }}</option>
            <option v-for="c in templateCategories" :key="c" :value="c">{{ CATEGORY_LABELS[c] ?? c }}</option>
          </select>
          <select v-model="serverId" class="form-control" :aria-label="$t('resourceNew.servidorDeDestino')">
            <option v-for="s in teamServers" :key="s.id" :value="s.id">{{ $t("resourceNew.servidorP0P1", { p0: s.name, p1: s.isPlatformHost ? " " + $t('common.thisMachine') : "" }) }}</option>
          </select>
        </div>
      </div>

      <div v-if="visibleCards.length === 0" class="empty-state">{{ $t("resourceNew.nadaBateComABusca") }}</div>

      <template v-for="section in sections" :key="section.category">
        <div v-if="visibleCards.some((c) => c.category === section.category)" class="card mb-16">
          <div class="card-header">
            <span class="material-symbols-outlined" style="font-size: 18px">{{ section.icon }}</span>
            {{ section.title }}
          </div>
          <div class="card-body">
            <p v-if="section.category === 'service'" class="hint mb-16">
              {{ $t("resourceNew.asMarcasCitadasPertencemAs") }}
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
                  <a v-if="card.docsUrl" :href="card.docsUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">{{ $t("resourceNew.docs") }}</a>
                  <a v-if="card.website" :href="card.website" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">{{ $t("resourceNew.website") }}</a>
                  <button type="button" class="btn btn-sm catalog-deploy" :disabled="creatingId !== null" @click="deploy(card)">
                    {{ creatingId === card.id ? $t("resourceNew.criando") : "Deploy" }}
                    <span class="material-symbols-outlined" style="font-size: 16px">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <Modal v-if="customModal" :title="$t('resourceNew.servicoComComposeProprio')" @close="customModal = false">
      <form @submit.prevent="createCustomService">
        <div class="form-group">
          <label for="cs-name">{{ $t("resourceNew.nome") }}</label>
          <input id="cs-name" v-model="customForm.name" class="form-control" required />
        </div>
        <div class="form-group">
          <label for="cs-compose">{{ $t("resourceNew.dockerComposeYml") }}</label>
          <textarea id="cs-compose" v-model="customForm.composeContent" class="form-control mono" rows="14" spellcheck="false" required></textarea>
          <p class="hint" style="margin-top: 6px">
            {{ $t("resourceNew.so") }} <span class="mono">{{ $t("resourceNew.image") }}</span> {{ $t("resourceNew.naoHaCodigoPra") }} <span class="mono">{{ $t("resourceNew.build") }}</span>{{ $t("resourceNew.variaveis") }} <span class="mono">${NOME}</span> {{ $t("resourceNew.saoLidasDoEnvDo") }} <span class="mono">{{ $t("resourceNew.nomeDoServicoContainer") }}</span>{{ $t("resourceNew.cuidadoCom") }} <span class="mono">{{ $t("resourceNew.privileged") }}</span>, <span class="mono">{{ $t("resourceNew.networkModeHost") }}</span> {{ $t("resourceNew.eMontagensDoHostDao") }}
          </p>
        </div>
        <div class="form-group">
          <label for="cs-port">{{ $t("resourceNew.portaDoPrimeiroServicoPro") }}</label>
          <input id="cs-port" v-model.number="customForm.port" type="number" class="form-control" style="max-width: 160px" />
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="submittingCustom">{{ submittingCustom ? $t("resourceNew.criando") : $t("resourceNew.criarServico") }}</button>
          <button type="button" class="btn btn-secondary" @click="customModal = false">{{ $t("resourceNew.cancelar") }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="dbModal" :title="`Novo banco — ${DATABASE_ENGINES[dbModal].label}`" @close="dbModal = null">
      <form @submit.prevent="createDatabase">
        <div class="form-group">
          <label for="db-name">{{ $t("resourceNew.nome") }}</label>
          <input id="db-name" v-model="dbForm.name" class="form-control" required />
        </div>
        <div class="form-group">
          <label for="db-version">{{ $t("resourceNew.versao") }}</label>
          <select id="db-version" v-model="dbForm.version" class="form-control" :disabled="Boolean(dbForm.customImage.trim())">
            <option v-for="v in DATABASE_ENGINES[dbModal].versions" :key="v" :value="v">{{ DATABASE_ENGINES[dbModal].imageRepo }}:{{ v }}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="db-custom">{{ $t("resourceNew.ouOutraImagem") }}</label>
          <input id="db-custom" v-model="dbForm.customImage" class="form-control mono" placeholder="postgis/postgis:16-3.4" />
        </div>
        <label class="check-row" style="margin-bottom: 12px">
          <input v-model="dbForm.publicAccess" type="checkbox" />
          <span>{{ $t("resourceNew.acessoExternoAbrirAPorta", { p0: DATABASE_ENGINES[dbModal].defaultPort }) }}</span>
        </label>
        <p class="hint mb-16">{{ $t("resourceNew.semAcessoExternoOBanco") }}</p>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="submittingDb">{{ submittingDb ? $t("resourceNew.criando") : $t("resourceNew.criarBanco") }}</button>
          <button type="button" class="btn btn-secondary" @click="dbModal = null">{{ $t("resourceNew.cancelar") }}</button>
        </div>
      </form>
    </Modal>

    <Modal v-if="appModal" :title="appModalTitles[appModal]" @close="appModal = null">
      <form @submit.prevent="createApp">
        <div class="form-group">
          <label for="app-name">{{ $t("resourceNew.nome") }}</label>
          <input id="app-name" v-model="appForm.name" class="form-control" :placeholder="$t('resourceNew.minhaApi')" required />
        </div>

        <div v-if="appModal === 'github'" class="form-group">
          <label for="app-github-repo">{{ $t("resourceNew.repositorio") }}</label>
          <select id="app-github-repo" v-model="appForm.githubRepo" class="form-control" required @change="onGithubRepoChange">
            <option value="" disabled>{{ $t("resourceNew.selecione") }}</option>
            <option v-for="repo in githubRepos" :key="repo.fullName" :value="repo.fullName">
              {{ repo.fullName }}{{ repo.private ? " (privado)" : "" }}
            </option>
          </select>
        </div>
        <template v-else-if="appModal === 'gitsource'">
          <div class="form-group">
            <label for="app-gitsource">{{ $t("resourceNew.fonte") }}</label>
            <select id="app-gitsource" v-model="appForm.gitSourceId" class="form-control" required @change="onGitSourceChange">
              <option value="" disabled>{{ $t("resourceNew.selecione") }}</option>
              <option v-for="src in gitSourcesList" :key="src.id" :value="src.id">{{ src.name }} ({{ src.baseUrl }})</option>
            </select>
          </div>
          <div class="form-group">
            <label for="app-gitrepo">{{ $t("resourceNew.repositorio") }}</label>
            <select v-if="gitRepos.length" id="app-gitrepo" v-model="appForm.gitRepo" class="form-control" required @change="onGitRepoChange">
              <option value="" disabled>{{ $t("resourceNew.selecione") }}</option>
              <option v-for="repo in gitRepos" :key="repo.fullName" :value="repo.fullName">{{ repo.fullName }}{{ repo.private ? " (privado)" : "" }}</option>
            </select>
            <input v-else id="app-gitrepo" v-model="appForm.gitRepo" class="form-control mono" placeholder="grupo/projeto" :disabled="loadingGitRepos" required />
            <p v-if="loadingGitRepos" class="hint" style="margin-top: 6px">{{ $t("resourceNew.listandoRepositorios") }}</p>
          </div>
        </template>
        <div v-else-if="modeUsesRepo(appModal)" class="form-group">
          <label for="app-repo">{{ $t("resourceNew.urlDoRepositorio") }}</label>
          <input
            id="app-repo"
            v-model="appForm.repoUrl"
            class="form-control mono"
            :placeholder="appModal === 'deploykey' ? 'git@github.com:org/repo.git' : 'https://github.com/...'"
            required
          />
          <p v-if="appModal === 'deploykey'" class="hint" style="margin-top: 6px">
            {{ $t("resourceNew.useAUrlSshDepois") }}
          </p>
        </div>
        <div v-if="appModal === 'deploykey' && sshKeysList.length > 0" class="form-group">
          <label for="app-deploykey-existing">{{ $t("resourceNew.deployKey") }}</label>
          <select id="app-deploykey-existing" v-model="appForm.deployKeySshKeyId" class="form-control">
            <option value="">{{ $t("resourceNew.gerarUmaNova") }}</option>
            <option v-for="k in sshKeysList" :key="k.id" :value="k.id">{{ $t("resourceNew.p0KeysTokens", { p0: k.name }) }}</option>
          </select>
          <p v-if="appForm.deployKeySshKeyId" class="hint" style="margin-top: 6px">
            {{ $t("resourceNew.essaChavePrecisaJaEstar") }}
          </p>
        </div>

        <template v-if="appModal === 'compose'">
          <div class="form-group">
            <label for="app-compose-file">{{ $t("resourceNew.arquivoCompose") }}</label>
            <input id="app-compose-file" v-model="appForm.composeFile" class="form-control mono" :placeholder="$t('resourceNew.dockerComposeYml')" />
            <p class="hint" style="margin-top: 6px">{{ $t("resourceNew.caminhoDentroDoRepositorioO") }} <span class="mono">{{ $t("resourceNew.dockerComposeUpDBuild") }}</span> {{ $t("resourceNew.eEsperaOsServicosFicarem") }}</p>
          </div>
          <div class="form-group">
            <label for="app-compose-service">{{ $t("resourceNew.servicoQueRecebeODominio") }}</label>
            <input id="app-compose-service" v-model="appForm.composeService" class="form-control mono" :placeholder="$t('resourceNew.web')" />
            <p class="hint" style="margin-top: 6px">{{ $t("resourceNew.nomeDoServicoNoCompose") }} <span class="mono">{{ $t("resourceNew.ports") }}</span> {{ $t("resourceNew.noProprioArquivo") }}</p>
          </div>
        </template>

        <div v-if="appModal === 'image'" class="form-group">
          <label for="app-image">{{ $t("resourceNew.imagem") }}</label>
          <input id="app-image" v-model="appForm.dockerImage" class="form-control mono" :placeholder="$t('resourceNew.nginx127Alpine')" required />
        </div>
        <div v-if="appModal === 'inline'" class="form-group">
          <label for="app-dockerfile">{{ $t("resourceNew.dockerfile") }}</label>
          <textarea id="app-dockerfile" v-model="appForm.dockerfileContent" class="form-control mono" rows="9" required></textarea>
        </div>
        <div v-if="appModal === 'static'" class="form-group">
          <label for="app-publish">{{ $t("resourceNew.pastaAPublicar") }}</label>
          <input id="app-publish" v-model="appForm.publishDirectory" class="form-control mono" :placeholder="$t('resourceNew.dist')" />
          <p class="hint" style="margin-top: 6px">{{ $t("resourceNew.relativaARaizDoRepositorio") }}</p>
        </div>

        <div class="form-row mb-16">
          <div v-if="modeUsesRepo(appModal) || appModal === 'github'" class="form-group" style="margin-bottom: 0">
            <label for="app-branch">{{ $t("resourceNew.branch") }}</label>
            <input id="app-branch" v-model="appForm.branch" class="form-control" :placeholder="$t('resourceNew.main')" />
          </div>
          <div v-if="appModal !== 'static'" class="form-group" style="margin-bottom: 0">
            <label for="app-port">{{ $t("resourceNew.portaDoApp") }}</label>
            <input id="app-port" v-model.number="appForm.port" type="number" class="form-control" />
          </div>
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="submittingApp">{{ submittingApp ? $t("resourceNew.criando") : $t("resourceNew.criarAplicacao") }}</button>
          <button type="button" class="btn btn-secondary" @click="appModal = null">{{ $t("resourceNew.cancelar") }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
