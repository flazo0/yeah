<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { GithubInstallationDto, GithubSourceResourceDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import StatusBadge from "../components/StatusBadge.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;
const sourceId = route.params.sourceId as string;

const installation = ref<GithubInstallationDto | null>(null);
const resources = ref<GithubSourceResourceDto[]>([]);
const loading = ref(true);
const error = ref("");
const confirmingDisconnect = ref(false);
const disconnecting = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const tabs = [
  { key: "general", label: "Geral", icon: "tune" },
  { key: "permissions", label: "Permissões", icon: "lock" },
  { key: "resources", label: "Recursos", icon: "deployed_code" },
] as const;
const tab = computed(() => tabs.find((t) => t.key === route.query.tab)?.key ?? "general");

const permissions = [
  { name: "Contents", level: "Read", why: "clonar o repositório e baixar o código no deploy" },
  { name: "Metadata", level: "Read", why: "listar os repositórios que o App enxerga" },
];

async function load() {
  try {
    const res = await api.get<{ installation: GithubInstallationDto | null }>(`/teams/${teamId}/github`);
    installation.value = res.installation && res.installation.id === sourceId ? res.installation : null;
    if (installation.value) {
      const list = await api.get<{ resources: GithubSourceResourceDto[] }>(`/teams/${teamId}/github/resources`);
      resources.value = list.resources;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar fonte";
  } finally {
    loading.value = false;
  }
}

async function disconnect() {
  if (!confirmingDisconnect.value) {
    confirmingDisconnect.value = true;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingDisconnect.value = false), 4000);
    return;
  }
  disconnecting.value = true;
  try {
    await api.delete(`/teams/${teamId}/github`);
    router.push(`/teams/${teamId}/sources`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao desconectar";
    disconnecting.value = false;
    confirmingDisconnect.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/sources`" class="breadcrumb-item">Fontes</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">{{ installation?.accountLogin ?? "…" }}</span>
    </nav>

    <PageState :loading="loading" :error="error" :empty="!installation" empty-icon="hub" empty-text="Fonte não encontrada.">
      <template v-if="installation">
        <div class="resource-header">
          <div class="resource-title">
            <span class="material-symbols-outlined">hub</span>
            {{ installation.accountLogin }}
            <StatusBadge status="connected" />
          </div>
          <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="disconnecting" @click="disconnect">
            <span class="material-symbols-outlined" style="font-size: 18px">link_off</span>
            {{ confirmingDisconnect ? "Confirmar desconexão?" : "Desconectar" }}
          </button>
        </div>
        <p class="resource-subtitle">GitHub · {{ installation.accountType }}</p>

        <div class="detail-tabs">
          <RouterLink
            v-for="t in tabs"
            :key="t.key"
            :to="{ query: { tab: t.key } }"
            class="detail-tab"
            :class="{ active: tab === t.key }"
          >
            <span class="material-symbols-outlined" style="font-size: 18px">{{ t.icon }}</span>
            {{ t.label }}
            <span v-if="t.key === 'resources'" class="badge badge-neutral">{{ resources.length }}</span>
          </RouterLink>
        </div>

        <div v-if="tab === 'general'" class="card">
          <div class="card-body">
            <dl class="kv-list">
              <div><dt>Conta</dt><dd class="mono">{{ installation.accountLogin }}</dd></div>
              <div><dt>Tipo</dt><dd>{{ installation.accountType }}</dd></div>
              <div><dt>Installation ID</dt><dd class="mono">{{ installation.installationId }}</dd></div>
              <div><dt>Conectada em</dt><dd>{{ new Date(installation.createdAt).toLocaleString("pt-BR") }}</dd></div>
            </dl>
            <p class="hint" style="margin-top: 16px">
              O App, a chave privada e o segredo de webhook ficam nas variáveis de ambiente da API (não no banco) — veja o
              <span class="mono">.env.example</span>.
            </p>
          </div>
        </div>

        <div v-else-if="tab === 'permissions'" class="card">
          <div class="rtable-wrap" style="border: none">
            <table class="rtable">
              <thead>
                <tr><th>Permissão</th><th>Nível</th><th>Pra quê</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in permissions" :key="p.name">
                  <td data-label="Permissão"><strong>{{ p.name }}</strong></td>
                  <td data-label="Nível">{{ p.level }}</td>
                  <td data-label="Pra quê">{{ p.why }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-body">
            <p class="hint">Escopo mínimo, somente leitura. Além disso o App assina o evento <span class="mono">push</span> pra disparar auto-deploy.</p>
          </div>
        </div>

        <div v-else class="card">
          <div v-if="resources.length === 0" class="card-body">
            <div class="empty-state">Nenhuma aplicação usa essa fonte ainda.</div>
          </div>
          <div v-else class="rtable-wrap" style="border: none">
            <table class="rtable">
              <thead>
                <tr><th>Aplicação</th><th>Repositório</th><th>Projeto</th><th>Ambiente</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in resources" :key="r.applicationId">
                  <td data-label="Aplicação">
                    <RouterLink
                      :to="`/teams/${teamId}/projects/${r.projectId}/environments/${r.environmentId}/apps/${r.applicationId}`"
                      class="rtable-name"
                    >
                      <strong>{{ r.applicationName }}</strong>
                    </RouterLink>
                  </td>
                  <td data-label="Repositório" class="mono">{{ r.repo }} ({{ r.branch }})</td>
                  <td data-label="Projeto">{{ r.projectName }}</td>
                  <td data-label="Ambiente">{{ r.environmentName }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="card-body">
            <p class="hint">Desconectar a fonte pára o auto-deploy dessas aplicações e impede novos deploys a partir do GitHub App.</p>
          </div>
        </div>
      </template>
    </PageState>
  </div>
</template>
