<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ServerDto, SshKeyDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import CodeEditor from "../components/CodeEditor.vue";

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
    error.value = err instanceof ApiError ? err.message : "falha ao gerar a chave";
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
    error.value = err instanceof ApiError ? err.message : "falha ao criar servidor";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/servers`" class="breadcrumb-item">Servidores</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">Adicionar servidor</span>
    </nav>
    <div class="page-header">
      <div>
        <h1>Adicionar servidor</h1>
        <p>Conecte uma máquina via SSH pra começar a fazer deploy nela.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <form @submit.prevent="addServer">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-name">Nome</label>
              <input id="server-name" v-model="form.name" class="form-control" placeholder="vps-producao" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-host">Host / IP</label>
              <input id="server-host" v-model="form.host" class="form-control" placeholder="203.0.113.10" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-port">Porta</label>
              <input id="server-port" v-model.number="form.port" type="number" class="form-control" placeholder="22" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-user">Usuário SSH</label>
              <input id="server-user" v-model="form.sshUser" class="form-control" placeholder="root" />
            </div>
          </div>
          <div v-if="savedKeys.length > 0" class="form-group">
            <label for="server-saved-key">Chave SSH</label>
            <select id="server-saved-key" v-model="form.sshKeyId" class="form-control">
              <option value="">Colar ou gerar uma nova (abaixo)</option>
              <option v-for="k in savedKeys" :key="k.id" :value="k.id">{{ k.name }} (Keys &amp; Tokens)</option>
            </select>
          </div>
          <div v-if="keyChoice === 'new'" class="form-group">
            <div class="btn-row" style="justify-content: space-between; align-items: center; margin-bottom: 6px">
              <label style="margin: 0">Chave privada SSH</label>
              <button type="button" class="btn btn-secondary btn-sm" :disabled="generating" @click="generateKey">
                <span class="material-symbols-outlined" style="font-size: 16px">key</span>
                {{ generating ? "gerando..." : "Gerar chave nova" }}
              </button>
            </div>
            <CodeEditor v-model="form.privateKey" :height="160" />
            <p class="hint" style="margin-top: 6px">
              Já tem uma chave autorizada no servidor? Cole aqui. Senão, gere uma nova e autorize a chave pública nele.
            </p>
          </div>
          <div v-if="authorizeCommand" class="callout mb-16">
            <strong>Autorize esta chave no servidor</strong>
            <p class="hint" style="margin: 4px 0 8px">
              Entre no servidor por SSH como <span class="mono">{{ form.sshUser || "root" }}</span> e rode o comando abaixo. A chave
              privada fica guardada criptografada no painel; a pública é só o que o servidor precisa conhecer.
            </p>
            <pre class="callout-code">{{ authorizeCommand }}</pre>
            <button type="button" class="btn btn-secondary btn-sm" @click="copyCommand">
              <span class="material-symbols-outlined" style="font-size: 16px">{{ copied ? "check" : "content_copy" }}</span>
              {{ copied ? "Copiado" : "Copiar comando" }}
            </button>
          </div>
          <div v-if="error" class="alert alert-error">{{ error }}</div>
          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? "adicionando..." : "Adicionar servidor" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
