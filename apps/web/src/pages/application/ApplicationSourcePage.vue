<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { GithubRepoDto, RegistryDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error, reloadApp } = useApplicationContext();
const teamId = useRoute().params.teamId as string;

const form = ref({ repoUrl: "", branch: "", githubRepo: "", dockerImage: "", dockerfileContent: "", publishDirectory: ".", composeFile: "", composeService: "", port: 3000 });
const githubRepos = ref<GithubRepoDto[]>([]);
const saving = ref(false);
const saved = ref(false);
const registries = ref<RegistryDto[]>([]);
const registryId = ref("");
const registryRepo = ref("");
const savingRegistry = ref(false);
const registrySaved = ref(false);

onMounted(async () => {
  const a = app.value;
  if (!a) return;
  form.value = {
    repoUrl: a.repoUrl,
    branch: a.branch,
    githubRepo: a.githubRepo ?? "",
    dockerImage: a.dockerImage ?? "",
    dockerfileContent: a.dockerfileContent ?? "",
    publishDirectory: a.publishDirectory,
    composeFile: a.composeFile,
    composeService: a.composeService ?? "",
    port: a.port,
  };
  registryId.value = a.registryId ?? "";
  registryRepo.value = a.registryImage ?? "";
  try {
    registries.value = (await api.get<{ registries: RegistryDto[] }>(`/teams/${teamId}/registries`)).registries;
  } catch {
    registries.value = [];
  }
  if (a.githubRepo) {
    try {
      githubRepos.value = (await api.get<{ repos: GithubRepoDto[] }>(`/teams/${teamId}/github/repos`)).repos;
    } catch {
      githubRepos.value = [];
    }
  }
});

async function saveRegistry() {
  savingRegistry.value = true;
  registrySaved.value = false;
  error.value = "";
  try {
    await api.put(`${basePath}/registry`, { registryId: registryId.value || null, repository: registryRepo.value });
    await reloadApp();
    registrySaved.value = true;
    setTimeout(() => (registrySaved.value = false), 2500);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar o registry";
  } finally {
    savingRegistry.value = false;
  }
}

async function save() {
  const a = app.value;
  if (!a) return;
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    const f = form.value;
    const body: Record<string, unknown> = { port: f.port };
    if (a.buildPack === "image") body.dockerImage = f.dockerImage;
    else if (a.buildPack === "dockerfile_inline") body.dockerfileContent = f.dockerfileContent;
    else {
      body.branch = f.branch;
      if (a.githubRepo) body.githubRepo = f.githubRepo;
      else body.repoUrl = f.repoUrl;
      if (a.buildPack === "static") body.publishDirectory = f.publishDirectory;
      if (a.buildPack === "docker_compose") {
        body.composeFile = f.composeFile;
        body.composeService = f.composeService;
      }
    }
    await api.put(`${basePath}/source`, body);
    await reloadApp();
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar a origem";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form v-if="app" class="card" style="margin-bottom: 0" @submit.prevent="save">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">merge</span>
      Origem do código
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        De onde o deploy tira o código. O build pack (<span class="mono">{{ app.buildPack }}</span>) não muda depois de criado — pra trocar, crie outra aplicação
        (ou clone esta em Operações). Vale a partir do próximo deploy.
      </p>

      <template v-if="app.buildPack === 'image'">
        <div class="form-group">
          <label for="src-image">Imagem</label>
          <input id="src-image" v-model="form.dockerImage" class="form-control mono" required />
        </div>
      </template>
      <template v-else-if="app.buildPack === 'dockerfile_inline'">
        <div class="form-group">
          <label for="src-dockerfile">Dockerfile</label>
          <textarea id="src-dockerfile" v-model="form.dockerfileContent" class="form-control mono" rows="10" required></textarea>
        </div>
      </template>
      <template v-else>
        <div v-if="app.githubRepo" class="form-group">
          <label for="src-github">Repositório do GitHub</label>
          <select v-if="githubRepos.length" id="src-github" v-model="form.githubRepo" class="form-control">
            <option v-for="repo in githubRepos" :key="repo.fullName" :value="repo.fullName">{{ repo.fullName }}</option>
          </select>
          <input v-else id="src-github" v-model="form.githubRepo" class="form-control mono" />
        </div>
        <div v-else class="form-group">
          <label for="src-repo">URL do repositório</label>
          <input id="src-repo" v-model="form.repoUrl" class="form-control mono" required />
          <p v-if="app.deployKeyPublic" class="hint" style="margin-top: 6px">Com deploy key a URL precisa ser SSH (<span class="mono">git@host:org/repo.git</span>).</p>
        </div>
        <div class="form-group">
          <label for="src-branch">Branch</label>
          <input id="src-branch" v-model="form.branch" class="form-control mono" required />
        </div>
        <div v-if="app.buildPack === 'static'" class="form-group">
          <label for="src-publish">Pasta publicada</label>
          <input id="src-publish" v-model="form.publishDirectory" class="form-control mono" />
        </div>
        <template v-if="app.buildPack === 'docker_compose'">
          <div class="form-group">
            <label for="src-compose">Arquivo compose</label>
            <input id="src-compose" v-model="form.composeFile" class="form-control mono" required />
          </div>
          <div class="form-group">
            <label for="src-service">Serviço que recebe o domínio</label>
            <input id="src-service" v-model="form.composeService" class="form-control mono" placeholder="web" />
          </div>
        </template>
      </template>

      <div v-if="app.buildPack !== 'static'" class="form-group">
        <label for="src-port">Porta do app</label>
        <input id="src-port" v-model.number="form.port" type="number" class="form-control" style="max-width: 160px" />
      </div>

      <div class="btn-row">
        <button type="submit" class="btn btn-secondary" :disabled="saving">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ saving ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
      </div>
    </div>
  </form>

  <div v-if="app && app.buildPack !== 'docker_compose'" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">inventory_2</span>
      Registry
    </div>
    <div class="card-body">
      <p v-if="app.buildPack === 'image'" class="hint mb-16">Escolha um registry pra entrar antes de baixar a imagem (imagem privada).</p>
      <p v-else class="hint mb-16">
        Depois de construir, o yeah envia a imagem pro registry com a tag do commit. Um novo deploy do mesmo commit — ou um rollback, ou outro servidor — baixa a imagem pronta em vez de construir de novo.
        Mudar as variáveis de build gera outra tag.
      </p>
      <div class="form-group">
        <label for="reg-select">Registry</label>
        <select id="reg-select" v-model="registryId" class="form-control" style="max-width: 320px">
          <option value="">Nenhum</option>
          <option v-for="r in registries" :key="r.id" :value="r.id">{{ r.name }} ({{ r.host }})</option>
        </select>
        <p v-if="registries.length === 0" class="hint" style="margin-top: 6px">Nenhum registry cadastrado — <RouterLink :to="`/teams/${teamId}/registries`" class="label-link">cadastre um</RouterLink>.</p>
      </div>
      <div v-if="registryId && app.buildPack !== 'image'" class="form-group">
        <label for="reg-repo">Repositório no registry</label>
        <input id="reg-repo" v-model="registryRepo" class="form-control mono" placeholder="minha-org/minha-app" />
        <p class="hint" style="margin-top: 6px">Em minúsculas. A imagem vai pra <span class="mono">registry/repositório:commit</span>.</p>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="savingRegistry" @click="saveRegistry">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ savingRegistry ? "salvando..." : "Salvar" }}
        </button>
        <span v-if="registrySaved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
      </div>
    </div>
  </div>
</template>
