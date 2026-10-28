<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ApiTokenDto, ApiTokenPermission } from "@yeah/shared";
import type { SshKeyDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import { i18n } from "../lib/i18n";
import { dateLocale } from "../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoCarregarAsChaves");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoCriarAChave");
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoExcluirAChave");
  }
}

onMounted(load);

// ---- API tokens
const tokens = ref<ApiTokenDto[]>([]);
const tokensLoading = ref(true);
const tokenFormOpen = ref(false);
const tokenForm = ref({ name: "", permission: "read" as ApiTokenPermission, expiresInDays: "", allowedIps: "" });
const tokenSubmitting = ref(false);
const justCreatedToken = ref<{ token: string; apiToken: ApiTokenDto } | null>(null);
const tokenCopied = ref(false);

const security = ref<{ requireTwoFactor: boolean; membersWithoutTwoFactor: string[]; youHaveTwoFactor: boolean } | null>(null);

async function loadSecurity() {
  try {
    security.value = await api.get(`/teams/${teamId}/security`);
  } catch {
    /* the card just stays hidden */
  }
}

async function toggleRequireTwoFactor() {
  if (!security.value) return;
  const next = !security.value.requireTwoFactor;
  try {
    await api.put(`/teams/${teamId}/security`, { requireTwoFactor: next });
    await loadSecurity();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoSalvar");
    await loadSecurity();
  }
}

const mcpEnabled = ref(false);

async function loadMcp() {
  try {
    mcpEnabled.value = (await api.get<{ mcpEnabled: boolean }>(`/teams/${teamId}/mcp-settings`)).mcpEnabled;
  } catch {
    /* the toggle just stays off if this fails */
  }
}

async function toggleMcp() {
  const next = !mcpEnabled.value;
  try {
    mcpEnabled.value = (await api.put<{ mcpEnabled: boolean }>(`/teams/${teamId}/mcp-settings`, { mcpEnabled: next })).mcpEnabled;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoSalvar");
  }
}

async function loadTokens() {
  tokensLoading.value = true;
  try {
    tokens.value = (await api.get<{ tokens: ApiTokenDto[] }>(`/teams/${teamId}/api-tokens`)).tokens;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoCarregarOsTokens");
  } finally {
    tokensLoading.value = false;
  }
}

function openTokenForm() {
  tokenForm.value = { name: "", permission: "read", expiresInDays: "", allowedIps: "" };
  justCreatedToken.value = null;
  tokenFormOpen.value = true;
}

async function submitToken() {
  tokenSubmitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ token: string; apiToken: ApiTokenDto }>(`/teams/${teamId}/api-tokens`, {
      name: tokenForm.value.name,
      permission: tokenForm.value.permission,
      expiresInDays: tokenForm.value.expiresInDays ? Number(tokenForm.value.expiresInDays) : undefined,
      allowedIps: tokenForm.value.allowedIps || undefined,
    });
    tokens.value = [res.apiToken, ...tokens.value];
    justCreatedToken.value = res;
    tokenFormOpen.value = false;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoCriarOToken");
  } finally {
    tokenSubmitting.value = false;
  }
}

async function copyToken() {
  if (!justCreatedToken.value) return;
  try {
    await navigator.clipboard.writeText(justCreatedToken.value.token);
    tokenCopied.value = true;
    setTimeout(() => (tokenCopied.value = false), 2000);
  } catch {
    tokenCopied.value = false;
  }
}

async function deleteToken(token: ApiTokenDto) {
  error.value = "";
  try {
    await api.delete(`/teams/${teamId}/api-tokens/${token.id}`);
    tokens.value = tokens.value.filter((t) => t.id !== token.id);
    if (justCreatedToken.value?.apiToken.id === token.id) justCreatedToken.value = null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("keysTokens.falhaAoExcluirOToken");
  }
}

onMounted(() => {
  void loadTokens();
  void loadMcp();
  void loadSecurity();
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("keysTokens.keysTokens") }}</h1>
        <p>{{ $t("keysTokens.chavesSshReutilizaveisGereOu") }}</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="justCreated" class="callout mb-16">
      <strong>{{ $t("keysTokens.chaveP0Criada", { p0: justCreated.name }) }}</strong>
      <p class="hint" style="margin: 4px 0 8px">
        {{ $t("keysTokens.autorizeAChavePublicaAbaixo") }}<span class="mono">{{ $t("keysTokens.sshAuthorizedKeys") }}</span>{{ $t("keysTokens.ouCadastreAComoDeploy") }}
      </p>
      <pre class="callout-code">{{ justCreated.publicKey }}</pre>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">key</span>
        {{ $t("keysTokens.chavesSsh") }}
        <div class="btn-row" style="margin-left: auto">
          <button type="button" class="btn btn-secondary btn-sm" @click="openForm('generate')">
            <span class="material-symbols-outlined" style="font-size: 16px">add</span>
            {{ $t("keysTokens.gerarChave") }}
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="openForm('import')">
            <span class="material-symbols-outlined" style="font-size: 16px">upload</span>
            {{ $t("keysTokens.importarChave") }}
          </button>
        </div>
      </div>

      <div v-if="formOpen" class="card-body" style="border-bottom: 1px solid var(--border)">
        <form @submit.prevent="submit">
          <div class="form-group">
            <label for="key-name">{{ $t("keysTokens.nome") }}</label>
            <input id="key-name" v-model="form.name" class="form-control" :placeholder="$t('keysTokens.deployVpsProducao')" required />
          </div>
          <template v-if="mode === 'import'">
            <div class="form-group">
              <label for="key-priv">{{ $t("keysTokens.chavePrivada") }}</label>
              <textarea id="key-priv" v-model="form.privateKey" class="form-control mono" rows="6" :placeholder="$t('keysTokens.beginOpensshPrivateKey')" required></textarea>
            </div>
            <div class="form-group">
              <label for="key-pub">{{ $t("keysTokens.chavePublica") }}</label>
              <input id="key-pub" v-model="form.publicKey" class="form-control mono" :placeholder="$t('keysTokens.sshEd25519AaaaComentario')" required />
            </div>
            <p class="hint mb-16">{{ $t("keysTokens.coleAsDuasMetadesDe") }} <span class="mono">{{ $t("keysTokens.sshKeygen") }}</span>{{ $t("keysTokens.oPainelNaoDerivaUma") }}</p>
          </template>
          <p v-else class="hint mb-16">{{ $t("keysTokens.geraUmParEd25519Novo") }}</p>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="submitting">
              <span class="material-symbols-outlined" style="font-size: 18px">check</span>
              {{ submitting ? $t("keysTokens.salvando") : "Salvar" }}
            </button>
            <button type="button" class="btn btn-secondary" @click="formOpen = false">{{ $t("keysTokens.cancelar") }}</button>
          </div>
        </form>
      </div>

      <div v-if="loading" class="card-body"><PageState loading /></div>
      <div v-else-if="keys.length === 0" class="card-body">
        <div class="empty-state">{{ $t("keysTokens.nenhumaChaveAindaGereOu") }}</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>{{ $t("keysTokens.nome") }}</th><th>{{ $t("keysTokens.chavePublica") }}</th><th>{{ $t("keysTokens.emUso") }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="key in keys" :key="key.id">
              <td>{{ key.name }}</td>
              <td class="mono" style="max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ key.publicKey }}</td>
              <td>{{ key.serversUsing > 0 ? `${key.serversUsing} servidor${key.serversUsing > 1 ? "es" : ""}` : "—" }}</td>
              <td>
                <div class="btn-row">
                  <button type="button" class="btn btn-secondary btn-sm" @click="copyPublicKey(key)">
                    <span class="material-symbols-outlined" style="font-size: 16px">{{ copied === key.id ? "check" : "content_copy" }}</span>
                    {{ copied === key.id ? $t('common.copied') : $t('common.copy') }}
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
                    {{ $t("keysTokens.excluir") }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="justCreatedToken" class="callout mb-16" style="margin-top: 16px">
      <strong>{{ $t("keysTokens.tokenP0Criado", { p0: justCreatedToken.apiToken.name }) }}</strong>
      <p class="hint" style="margin: 4px 0 8px">{{ $t("keysTokens.copieAgoraEleNaoAparece") }}</p>
      <div class="btn-row">
        <pre class="callout-code" style="margin: 0; flex: 1">{{ justCreatedToken.token }}</pre>
        <button type="button" class="btn btn-secondary btn-sm" @click="copyToken">
          <span class="material-symbols-outlined" style="font-size: 16px">{{ tokenCopied ? "check" : "content_copy" }}</span>
          {{ tokenCopied ? $t('common.copied') : $t('common.copy') }}
        </button>
      </div>
    </div>

    <div v-if="security" class="card" style="margin-top: 16px">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">verified_user</span>
        {{ $t("keysTokens.segurancaDoTime") }}
      </div>
      <div class="card-body">
        <label style="display: flex; gap: 8px; align-items: center">
          <input id="require-2fa" type="checkbox" :checked="security.requireTwoFactor" @change="toggleRequireTwoFactor" />
          {{ $t("keysTokens.exigir2fa") }}
        </label>
        <p class="hint">{{ $t("keysTokens.exigir2faDica") }}</p>
        <p v-if="security.membersWithoutTwoFactor.length" class="hint">
          {{ $t("keysTokens.semDoisFatores") }} {{ security.membersWithoutTwoFactor.join(", ") }}
        </p>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">smart_toy</span>
        {{ $t("keysTokens.servidorMcp") }}
      </div>
      <div class="card-body">
        <label style="display: flex; gap: 8px; align-items: center">
          <input id="mcp-enabled" type="checkbox" :checked="mcpEnabled" @change="toggleMcp" />
          {{ $t("keysTokens.permitirQueAgentesDeIa") }}
        </label>
        <p class="hint">
          {{ $t("keysTokens.endpoint") }} <code>POST /teams/{{ teamId }}/mcp</code> {{ $t("keysTokens.com") }} <code>Authorization: Bearer &lt;token&gt;</code>{{ $t("keysTokens.tokenSoDeLeituraModo") }}
        </p>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">vpn_key</span>
        {{ $t("keysTokens.tokensDeApi") }}
        <button type="button" class="btn btn-secondary btn-sm" style="margin-left: auto" @click="openTokenForm">
          <span class="material-symbols-outlined" style="font-size: 16px">add</span>
          {{ $t("keysTokens.novoToken") }}
        </button>
      </div>

      <div v-if="tokenFormOpen" class="card-body" style="border-bottom: 1px solid var(--border)">
        <form @submit.prevent="submitToken">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="token-name">{{ $t("keysTokens.nome") }}</label>
              <input id="token-name" v-model="tokenForm.name" class="form-control" :placeholder="$t('keysTokens.ciDeploy')" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="token-perm">{{ $t("keysTokens.permissao") }}</label>
              <select id="token-perm" v-model="tokenForm.permission" class="form-control">
                <option value="read">{{ $t("keysTokens.soLeitura") }}</option>
                <option value="full">{{ $t("keysTokens.leituraEEscritaDeployBackup") }}</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="token-exp">{{ $t("keysTokens.expiraEmDiasOpcional") }}</label>
              <input id="token-exp" v-model="tokenForm.expiresInDays" type="number" min="1" class="form-control" :placeholder="$t('keysTokens.semExpiracao')" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="token-ips">{{ $t("keysTokens.ipsPermitidosOpcional") }}</label>
              <input id="token-ips" v-model="tokenForm.allowedIps" class="form-control" placeholder="203.0.113.5, 10.0.0.0/8" />
            </div>
          </div>
          <p class="hint mb-16">
            {{ $t("keysTokens.usadoPelaApiDeCi") }}<span class="mono">{{ $t("keysTokens.teamsP0Ci", { p0: teamId }) }}</span>{{ $t("keysTokens.listarEDispararDeployBackup") }}
          </p>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="tokenSubmitting">
              <span class="material-symbols-outlined" style="font-size: 18px">check</span>
              {{ tokenSubmitting ? $t("keysTokens.criando") : $t("keysTokens.criarToken") }}
            </button>
            <button type="button" class="btn btn-secondary" @click="tokenFormOpen = false">{{ $t("keysTokens.cancelar") }}</button>
          </div>
        </form>
      </div>

      <div v-if="tokensLoading" class="card-body"><PageState loading /></div>
      <div v-else-if="tokens.length === 0" class="card-body">
        <div class="empty-state">{{ $t("keysTokens.nenhumTokenAinda") }}</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>{{ $t("keysTokens.nome") }}</th><th>{{ $t("keysTokens.prefixo") }}</th><th>{{ $t("keysTokens.permissao") }}</th><th>{{ $t("keysTokens.ips") }}</th><th>{{ $t("keysTokens.expira") }}</th><th>{{ $t("keysTokens.ultimoUso") }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="token in tokens" :key="token.id">
              <td>{{ token.name }}</td>
              <td class="mono">{{ token.tokenPrefix }}…</td>
              <td>{{ token.permission === "full" ? $t("keysTokens.leituraEEscrita") : $t("keysTokens.soLeitura") }}</td>
              <td class="mono">{{ token.allowedIps ?? "qualquer" }}</td>
              <td>{{ token.expiresAt ? new Date(token.expiresAt).toLocaleDateString(dateLocale()) : "nunca" }}</td>
              <td>{{ token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString(dateLocale()) : "nunca" }}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteToken(token)">
                  <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                  {{ $t("keysTokens.revogar") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
