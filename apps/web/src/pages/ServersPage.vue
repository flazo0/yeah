<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { ServerDto, WsServerEvent } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { wsClient } from "../lib/ws";
import CodeEditor from "../components/CodeEditor.vue";
import ServerTerminal from "../components/ServerTerminal.vue";

const route = useRoute();
const teamId = route.params.teamId as string;

const servers = ref<ServerDto[]>([]);
const loading = ref(true);
const error = ref("");

const form = ref({ name: "", host: "", port: 22, sshUser: "root", privateKey: "" });
const submitting = ref(false);

const statusBadge: Record<ServerDto["status"], string> = {
  connected: "badge-good",
  pending: "badge-warn",
  error: "badge-bad",
};
const proxyStatusBadge: Record<ServerDto["proxyStatus"], string> = {
  active: "badge-good",
  provisioning: "badge-warn",
  inactive: "badge-neutral",
  error: "badge-bad",
};

const domainForms = ref<Record<string, { wildcardDomain: string; acmeEmail: string }>>({});
const savingDomain = ref<string | null>(null);
const activatingProxy = ref<string | null>(null);

function syncDomainForms() {
  for (const server of servers.value) {
    if (!domainForms.value[server.id]) {
      domainForms.value[server.id] = {
        wildcardDomain: server.wildcardDomain ?? "",
        acmeEmail: server.acmeEmail ?? "",
      };
    }
  }
}

function getDomainForm(serverId: string) {
  return (domainForms.value[serverId] ??= { wildcardDomain: "", acmeEmail: "" });
}

async function saveDomain(serverId: string) {
  savingDomain.value = serverId;
  try {
    const res = await api.put<{ server: ServerDto }>(`/teams/${teamId}/servers/${serverId}/domain`, getDomainForm(serverId));
    const index = servers.value.findIndex((s) => s.id === serverId);
    if (index !== -1) servers.value[index] = res.server;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar domínio";
  } finally {
    savingDomain.value = null;
  }
}

async function activateProxy(serverId: string) {
  activatingProxy.value = serverId;
  error.value = "";
  try {
    await api.post(`/teams/${teamId}/servers/${serverId}/proxy`);
    const server = servers.value.find((s) => s.id === serverId);
    if (server) server.proxyStatus = "provisioning";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao ativar proxy";
  } finally {
    activatingProxy.value = null;
  }
}

async function loadServers() {
  loading.value = true;
  try {
    const res = await api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`);
    servers.value = res.servers;
    syncDomainForms();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar servidores";
  } finally {
    loading.value = false;
  }
}

async function addServer() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ server: ServerDto }>(`/teams/${teamId}/servers`, form.value);
    servers.value.push(res.server);
    syncDomainForms();
    form.value = { name: "", host: "", port: 22, sshUser: "root", privateKey: "" };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar servidor";
  } finally {
    submitting.value = false;
  }
}

function metricBarClass(value: number | null, threshold: number): string {
  if (value === null) return "metric-bar-fill-neutral";
  if (value >= threshold) return "metric-bar-fill-bad";
  if (value >= threshold - 20) return "metric-bar-fill-warn";
  return "metric-bar-fill-good";
}

async function testConnection(serverId: string) {
  const server = servers.value.find((s) => s.id === serverId);
  if (server) server.status = "pending";
  await api.post(`/teams/${teamId}/servers/${serverId}/test-connection`);
}

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  loadServers();
  unsubscribe = wsClient.on((event: WsServerEvent) => {
    if (event.type === "server.status") {
      const server = servers.value.find((s) => s.id === event.serverId);
      if (server) {
        server.status = event.status;
        server.dockerVersion = event.dockerVersion ?? null;
      }
    }
    if (event.type === "server.proxy") {
      const server = servers.value.find((s) => s.id === event.serverId);
      if (server) server.proxyStatus = event.proxyStatus;
    }
    if (event.type === "server.metrics") {
      const server = servers.value.find((s) => s.id === event.serverId);
      if (server) {
        server.cpuPercent = event.cpuPercent;
        server.memPercent = event.memPercent;
        server.diskPercent = event.diskPercent;
      }
    }
  });
});

onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Servidores</h1>
        <p>Conecte um servidor via SSH pra começar a fazer deploy nele.</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
        Servidores do time
      </div>
      <div v-if="loading" class="card-body">
        <div class="empty-state">carregando...</div>
      </div>
      <div v-else-if="servers.length === 0" class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">dns</span>
          Nenhum servidor ainda. Adicione um abaixo.
        </div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Servidor</th>
              <th>Endereço</th>
              <th>Status</th>
              <th>Docker</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="server in servers" :key="server.id">
              <td><strong>{{ server.name }}</strong></td>
              <td class="mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</td>
              <td><span class="badge" :class="statusBadge[server.status]">{{ server.status }}</span></td>
              <td class="mono">{{ server.dockerVersion || "-" }}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" @click="testConnection(server.id)">
                  <span class="material-symbols-outlined" style="font-size: 16px">sync</span>
                  testar conexão
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-for="server in servers" :key="`proxy-${server.id}`" class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
        Proxy reverso — {{ server.name }}
        <span class="badge" :class="proxyStatusBadge[server.proxyStatus]" style="margin-left: auto">{{ server.proxyStatus }}</span>
      </div>
      <div class="card-body">
        <p class="hint mb-16">
          Ativa um Traefik nesse servidor com HTTPS automático (Let's Encrypt). Sem domínio, o app publica a porta
          direto no host — pode colidir com outras apps.
        </p>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label :for="`wildcard-${server.id}`">Domínio wildcard</label>
            <input
              :id="`wildcard-${server.id}`"
              v-model="getDomainForm(server.id).wildcardDomain"
              class="form-control mono"
              placeholder="apps.meudominio.com"
            />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label :for="`acme-${server.id}`">E-mail (Let's Encrypt)</label>
            <input :id="`acme-${server.id}`" v-model="getDomainForm(server.id).acmeEmail" class="form-control" placeholder="voce@exemplo.com" />
          </div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn btn-secondary" :disabled="savingDomain === server.id" @click="saveDomain(server.id)">
            <span class="material-symbols-outlined" style="font-size: 18px">save</span>
            {{ savingDomain === server.id ? "salvando..." : "Salvar" }}
          </button>
          <button
            type="button"
            class="btn"
            :disabled="activatingProxy === server.id || server.proxyStatus === 'provisioning'"
            @click="activateProxy(server.id)"
          >
            <span class="material-symbols-outlined" style="font-size: 18px">bolt</span>
            {{ server.proxyStatus === "active" ? "Reativar proxy" : "Ativar proxy" }}
          </button>
        </div>
      </div>
    </div>

    <div v-for="server in servers" :key="`metrics-${server.id}`" class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">monitor_heart</span>
        Recursos — {{ server.name }}
      </div>
      <div class="card-body">
        <div v-if="server.metricsCheckedAt === null" class="empty-state">
          Sem dados ainda — a primeira checagem roda até 1 minuto depois do servidor conectar.
        </div>
        <div v-else class="grid grid-3">
          <div>
            <div class="stat-label">CPU · {{ server.cpuPercent }}%</div>
            <div class="metric-bar"><div class="metric-bar-fill" :class="metricBarClass(server.cpuPercent, 90)" :style="{ width: `${server.cpuPercent}%` }"></div></div>
          </div>
          <div>
            <div class="stat-label">RAM · {{ server.memPercent }}%</div>
            <div class="metric-bar"><div class="metric-bar-fill" :class="metricBarClass(server.memPercent, 90)" :style="{ width: `${server.memPercent}%` }"></div></div>
          </div>
          <div>
            <div class="stat-label">Disco · {{ server.diskPercent }}%</div>
            <div class="metric-bar"><div class="metric-bar-fill" :class="metricBarClass(server.diskPercent, 85)" :style="{ width: `${server.diskPercent}%` }"></div></div>
          </div>
        </div>
      </div>
    </div>

    <div v-for="server in servers" :key="`term-${server.id}`" class="mb-16">
      <ServerTerminal :server-name="server.name" />
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Adicionar servidor
      </div>
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
          <div class="form-group">
            <label>Chave privada SSH</label>
            <CodeEditor v-model="form.privateKey" :height="160" />
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
