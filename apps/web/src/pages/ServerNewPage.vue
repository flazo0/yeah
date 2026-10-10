<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ServerDto, SshKeyDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import CodeEditor from "../components/CodeEditor.vue";
import { i18n } from "../lib/i18n";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;

const form = ref({ name: "", host: "", port: 22, sshUser: "root", privateKey: "", sshKeyId: "" });
const submitting = ref(false);
const error = ref("");

const generating = ref(false);
const publicKey = ref("");
const copied = ref(false);

const savedKeys = ref<SshKeyDto[]>([]);
const keyChoice = computed(() => (savedKeys.value.length === 0 ? "new" : form.value.sshKeyId ? "saved" : "new"));
const savedKeyPublic = computed(() => savedKeys.value.find((k) => k.id === form.value.sshKeyId)?.publicKey ?? "");
api
  .get<{ keys: SshKeyDto[] }>(`/teams/${teamId}/ssh-keys`)
  .then((res) => (savedKeys.value = res.keys))
  .catch(() => (savedKeys.value = []));

// Run on the server being added, as the SSH user chosen below — authorizes the generated/chosen key.
const authorizeCommand = computed(() => {
  const key = keyChoice.value === "saved" ? savedKeyPublic.value : publicKey.value;
  return key ? `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${key}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys` : "";
});

async function generateKey() {
  generating.value = true;
  error.value = "";
  copied.value = false;
  try {
    const res = await api.post<{ privateKey: string; publicKey: string }>(`/teams/${teamId}/servers/generate-key`);
    form.value.privateKey = res.privateKey;
    publicKey.value = res.publicKey;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverNew.falhaAoGerarAChave");
  } finally {
    generating.value = false;
  }
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(authorizeCommand.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

const PROVIDER_DEFAULTS = {
  hetzner: { size: "cx22", region: "nbg1", image: "ubuntu-24.04", label: "Hetzner Cloud" },
  digitalocean: { size: "s-1vcpu-2gb", region: "nyc3", image: "ubuntu-24-04-x64", label: "DigitalOcean" },
  vultr: { size: "vc2-1c-2gb", region: "ewr", image: "2284", label: "Vultr (imagem = os_id)" },
} as const;
const hz = ref({ provider: "hetzner" as keyof typeof PROVIDER_DEFAULTS, apiToken: "", name: "", size: "cx22", region: "nbg1", image: "ubuntu-24.04", sshKeyId: "" });
function pickProvider() {
  const d = PROVIDER_DEFAULTS[hz.value.provider];
  hz.value.size = d.size;
  hz.value.region = d.region;
  hz.value.image = d.image;
}
const hzSubmitting = ref(false);
const hzError = ref("");

async function createOnHetzner() {
  hzSubmitting.value = true;
  hzError.value = "";
  try {
    const res = await api.post<{ server: ServerDto }>(`/teams/${teamId}/servers/create-vps`, hz.value);
    router.push(`/teams/${teamId}/servers/${res.server.id}/general`);
  } catch (err) {
    hzError.value = err instanceof ApiError ? err.message : i18n.global.t("serverNew.falhaAoCriarAVps");
  } finally {
    hzSubmitting.value = false;
  }
}

async function addServer() {
  submitting.value = true;
  error.value = "";
  try {
    const payload =
      keyChoice.value === "saved"
        ? { name: form.value.name, host: form.value.host, port: form.value.port, sshUser: form.value.sshUser, sshKeyId: form.value.sshKeyId }
        : { name: form.value.name, host: form.value.host, port: form.value.port, sshUser: form.value.sshUser, privateKey: form.value.privateKey };
    const res = await api.post<{ server: ServerDto }>(`/teams/${teamId}/servers`, payload);
    router.push(`/teams/${teamId}/servers/${res.server.id}/general`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverNew.falhaAoCriarServidor");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/servers`" class="breadcrumb-item">{{ $t("serverNew.servidores") }}</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">{{ $t("serverNew.adicionarServidor") }}</span>
    </nav>
    <div class="page-header">
      <div>
        <h1>{{ $t("serverNew.adicionarServidor") }}</h1>
        <p>{{ $t("serverNew.conecteUmaMaquinaViaSsh") }}</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add_circle</span>
        {{ $t("serverNew.criarUmaVpsNovaHetzner") }}
      </div>
      <div class="card-body">
        <p class="hint">
          {{ $t("serverNew.criaAMaquinaUmFirewall") }}
        </p>
        <p v-if="savedKeys.length === 0" class="hint">{{ $t("serverNew.crieUmaChaveEmKeys") }}</p>
        <form v-else @submit.prevent="createOnHetzner">
          <div class="form-group">
            <label for="hz-provider">{{ $t("serverNew.provedor") }}</label>
            <select id="hz-provider" v-model="hz.provider" class="form-control" @change="pickProvider">
              <option v-for="(d, key) in PROVIDER_DEFAULTS" :key="key" :value="key">{{ d.label }}</option>
            </select>
          </div>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="hz-name">{{ $t("serverNew.nome") }}</label>
              <input id="hz-name" v-model="hz.name" class="form-control" :placeholder="$t('serverNew.vpsProducao')" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="hz-key">{{ $t("serverNew.chaveSsh") }}</label>
              <select id="hz-key" v-model="hz.sshKeyId" class="form-control" required>
                <option value="" disabled>{{ $t("serverNew.escolha") }}</option>
                <option v-for="k in savedKeys" :key="k.id" :value="k.id">{{ k.name }}</option>
              </select>
            </div>
          </div>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="hz-type">{{ $t("serverNew.tipo") }}</label>
              <input id="hz-type" v-model="hz.size" class="form-control mono" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="hz-loc">{{ $t("serverNew.local") }}</label>
              <input id="hz-loc" v-model="hz.region" class="form-control mono" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="hz-image">{{ $t("serverNew.imagem") }}</label>
              <input id="hz-image" v-model="hz.image" class="form-control mono" required />
            </div>
          </div>
          <div class="form-group">
            <label for="hz-token">{{ $t("serverNew.tokenDaApiDoProvedor") }}</label>
            <input id="hz-token" v-model="hz.apiToken" type="password" class="form-control mono" autocomplete="off" required />
          </div>
          <div v-if="hzError" class="alert alert-error mb-16">{{ hzError }}</div>
          <button type="submit" class="btn" :disabled="hzSubmitting">{{ hzSubmitting ? $t("serverNew.criando") : $t("serverNew.criarVps") }}</button>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <form @submit.prevent="addServer">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-name">{{ $t("serverNew.nome") }}</label>
              <input id="server-name" v-model="form.name" class="form-control" :placeholder="$t('serverNew.vpsProducao')" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-host">{{ $t("serverNew.hostIp") }}</label>
              <input id="server-host" v-model="form.host" class="form-control" placeholder="203.0.113.10" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-port">{{ $t("serverNew.porta") }}</label>
              <input id="server-port" v-model.number="form.port" type="number" class="form-control" placeholder="22" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-user">{{ $t("serverNew.usuarioSsh") }}</label>
              <input id="server-user" v-model="form.sshUser" class="form-control" :placeholder="$t('serverNew.root')" />
            </div>
          </div>
          <div v-if="savedKeys.length > 0" class="form-group">
            <label for="server-saved-key">{{ $t("serverNew.chaveSsh") }}</label>
            <select id="server-saved-key" v-model="form.sshKeyId" class="form-control">
              <option value="">{{ $t("serverNew.colarOuGerarUmaNova") }}</option>
              <option v-for="k in savedKeys" :key="k.id" :value="k.id">{{ $t("serverNew.p0KeysTokens", { p0: k.name }) }}</option>
            </select>
          </div>
          <div v-if="keyChoice === 'new'" class="form-group">
            <div class="btn-row" style="justify-content: space-between; align-items: center; margin-bottom: 6px">
              <label style="margin: 0">{{ $t("serverNew.chavePrivadaSsh") }}</label>
              <button type="button" class="btn btn-secondary btn-sm" :disabled="generating" @click="generateKey">
                <span class="material-symbols-outlined" style="font-size: 16px">key</span>
                {{ generating ? $t("serverNew.gerando") : $t("serverNew.gerarChaveNova") }}
              </button>
            </div>
            <CodeEditor v-model="form.privateKey" :height="160" />
            <p class="hint" style="margin-top: 6px">
              {{ $t("serverNew.jaTemUmaChaveAutorizada") }}
            </p>
          </div>
          <div v-if="authorizeCommand" class="callout mb-16">
            <strong>{{ $t("serverNew.autorizeEstaChaveNoServidor") }}</strong>
            <p class="hint" style="margin: 4px 0 8px">
              {{ $t("serverNew.entreNoServidorPorSsh") }} <span class="mono">{{ form.sshUser || "root" }}</span> {{ $t("serverNew.eRodeOComandoAbaixo") }}
            </p>
            <pre class="callout-code">{{ authorizeCommand }}</pre>
            <button type="button" class="btn btn-secondary btn-sm" @click="copyCommand">
              <span class="material-symbols-outlined" style="font-size: 16px">{{ copied ? "check" : "content_copy" }}</span>
              {{ copied ? $t('common.copied') : $t("serverNew.copiarComando") }}
            </button>
          </div>
          <div v-if="error" class="alert alert-error">{{ error }}</div>
          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? $t("serverNew.adicionando") : $t("serverNew.adicionarServidor") }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
