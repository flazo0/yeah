<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { SshKeyDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";

const route = useRoute();
const teamId = route.params.teamId as string;

const keys = ref<SshKeyDto[]>([]);
const loading = ref(true);
const error = ref("");

const formOpen = ref(false);
const mode = ref<"generate" | "import">("generate");
const form = ref({ name: "", privateKey: "", publicKey: "" });
const submitting = ref(false);
const justCreated = ref<SshKeyDto | null>(null);
const copied = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    keys.value = (await api.get<{ keys: SshKeyDto[] }>(`/teams/${teamId}/ssh-keys`)).keys;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar as chaves";
  } finally {
    loading.value = false;
  }
}

function openForm(m: "generate" | "import") {
  mode.value = m;
  form.value = { name: "", privateKey: "", publicKey: "" };
  justCreated.value = null;
  formOpen.value = true;
}

async function submit() {
  submitting.value = true;
  error.value = "";
  try {
    const res =
      mode.value === "generate"
        ? await api.post<{ key: SshKeyDto }>(`/teams/${teamId}/ssh-keys/generate`, { name: form.value.name })
        : await api.post<{ key: SshKeyDto }>(`/teams/${teamId}/ssh-keys/import`, form.value);
    keys.value = [res.key, ...keys.value];
    justCreated.value = res.key;
    formOpen.value = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar a chave";
  } finally {
    submitting.value = false;
  }
}

async function copyPublicKey(key: SshKeyDto) {
  try {
    await navigator.clipboard.writeText(key.publicKey);
    copied.value = key.id;
    setTimeout(() => {
      if (copied.value === key.id) copied.value = null;
    }, 2000);
  } catch {
    copied.value = null;
  }
}

async function deleteKey(key: SshKeyDto) {
  error.value = "";
  try {
    await api.delete(`/teams/${teamId}/ssh-keys/${key.id}`);
    keys.value = keys.value.filter((k) => k.id !== key.id);
    if (justCreated.value?.id === key.id) justCreated.value = null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir a chave";
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Keys &amp; Tokens</h1>
        <p>Chaves SSH reutilizáveis: gere ou importe uma vez e escolha ela ao adicionar um servidor ou uma deploy key, em vez de gerar (e reautorizar) uma nova toda hora.</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="justCreated" class="callout mb-16">
      <strong>Chave "{{ justCreated.name }}" criada</strong>
      <p class="hint" style="margin: 4px 0 8px">
        Autorize a chave pública abaixo em cada servidor (<span class="mono">~/.ssh/authorized_keys</span>) ou cadastre-a como deploy key no seu
        repositório antes de usá-la.
      </p>
      <pre class="callout-code">{{ justCreated.publicKey }}</pre>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">key</span>
        Chaves SSH
        <div class="btn-row" style="margin-left: auto">
          <button type="button" class="btn btn-secondary btn-sm" @click="openForm('generate')">
            <span class="material-symbols-outlined" style="font-size: 16px">add</span>
            Gerar chave
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="openForm('import')">
            <span class="material-symbols-outlined" style="font-size: 16px">upload</span>
            Importar chave
          </button>
        </div>
      </div>

      <div v-if="formOpen" class="card-body" style="border-bottom: 1px solid var(--border)">
        <form @submit.prevent="submit">
          <div class="form-group">
            <label for="key-name">Nome</label>
            <input id="key-name" v-model="form.name" class="form-control" placeholder="deploy-vps-producao" required />
          </div>
          <template v-if="mode === 'import'">
            <div class="form-group">
              <label for="key-priv">Chave privada</label>
              <textarea id="key-priv" v-model="form.privateKey" class="form-control mono" rows="6" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" required></textarea>
            </div>
            <div class="form-group">
              <label for="key-pub">Chave pública</label>
              <input id="key-pub" v-model="form.publicKey" class="form-control mono" placeholder="ssh-ed25519 AAAA... comentário" required />
            </div>
            <p class="hint mb-16">Cole as duas metades de um par que você já gerou (ex.: com <span class="mono">ssh-keygen</span>). O painel não deriva uma da outra.</p>
          </template>
          <p v-else class="hint mb-16">Gera um par ed25519 novo. A chave privada fica só no painel (criptografada) — você recebe a pública pra autorizar.</p>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="submitting">
              <span class="material-symbols-outlined" style="font-size: 18px">check</span>
              {{ submitting ? "salvando..." : "Salvar" }}
            </button>
            <button type="button" class="btn btn-secondary" @click="formOpen = false">Cancelar</button>
          </div>
        </form>
      </div>

      <div v-if="loading" class="card-body"><PageState loading /></div>
      <div v-else-if="keys.length === 0" class="card-body">
        <div class="empty-state">Nenhuma chave ainda. Gere ou importe uma pra reutilizar em vários servidores.</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Chave pública</th><th>Em uso</th><th></th></tr></thead>
          <tbody>
            <tr v-for="key in keys" :key="key.id">
              <td>{{ key.name }}</td>
              <td class="mono" style="max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ key.publicKey }}</td>
              <td>{{ key.serversUsing > 0 ? `${key.serversUsing} servidor${key.serversUsing > 1 ? "es" : ""}` : "—" }}</td>
              <td>
                <div class="btn-row">
                  <button type="button" class="btn btn-secondary btn-sm" @click="copyPublicKey(key)">
                    <span class="material-symbols-outlined" style="font-size: 16px">{{ copied === key.id ? "check" : "content_copy" }}</span>
                    {{ copied === key.id ? "Copiado" : "Copiar" }}
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary btn-sm"
                    style="color: var(--bad)"
                    :disabled="key.serversUsing > 0"
                    :title="key.serversUsing > 0 ? 'em uso — troque a chave dos servidores antes' : ''"
                    @click="deleteKey(key)"
                  >
                    <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                    Excluir
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
