<script setup lang="ts">
import { ref } from "vue";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { server, teamId, error, replaceServer } = useServerContext();

const form = ref({ wildcardDomain: server.value?.wildcardDomain ?? "", acmeEmail: server.value?.acmeEmail ?? "" });
const saving = ref(false);
const activating = ref(false);

async function save() {
  if (!server.value) return;
  saving.value = true;
  error.value = "";
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${server.value.id}/domain`, form.value);
    replaceServer(res.server);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar domínio";
  } finally {
    saving.value = false;
  }
}

async function activate() {
  if (!server.value) return;
  activating.value = true;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/proxy`);
    server.value.proxyStatus = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao ativar proxy";
  } finally {
    activating.value = false;
  }
}
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
      Proxy reverso
      <StatusBadge :status="server.proxyStatus" style="margin-left: auto" />
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Ativa um Traefik nesse servidor com HTTPS automático (Let's Encrypt). Sem domínio, o app publica a porta
        direto no host — pode colidir com outras apps.
      </p>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="wildcard">Domínio wildcard</label>
          <input id="wildcard" v-model="form.wildcardDomain" class="form-control mono" placeholder="apps.meudominio.com" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="acme">E-mail (Let's Encrypt)</label>
          <input id="acme" v-model="form.acmeEmail" class="form-control" placeholder="voce@exemplo.com" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
          <span class="material-symbols-outlined" style="font-size: 18px">save</span>
          {{ saving ? "salvando..." : "Salvar" }}
        </button>
        <button type="button" class="btn" :disabled="activating || server.proxyStatus === 'provisioning'" @click="activate">
          <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
          {{ server.proxyStatus === "active" ? "Reativar proxy" : "Ativar proxy" }}
        </button>
      </div>
    </div>
  </div>
</template>
