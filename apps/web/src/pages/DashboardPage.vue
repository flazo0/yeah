<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeploymentStatus, ServerDto, TeamOverviewDto } from "@yeah/shared";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

const auth = useAuthStore();
const name = ref("");
const creating = ref(false);
const error = ref("");

async function createTeam() {
  if (!name.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    await auth.createTeam(name.value.trim());
    name.value = "";
  } catch {
    error.value = "não foi possível criar o time";
  } finally {
    creating.value = false;
  }
}

// Single-admin instances almost always have exactly one team (the personal one) — showing an
// overview for it here, instead of just a picker, is the difference between "a dashboard" and
// "a CRUD list of teams". Multi-team accounts still get the picker below either way.
const primaryTeam = computed(() => auth.teams[0] ?? null);
const overview = ref<TeamOverviewDto | null>(null);
const servers = ref<ServerDto[]>([]);
const loadingOverview = ref(false);

const deploymentBadge: Record<DeploymentStatus, string> = {
  queued: "badge-neutral",
  running: "badge-warn",
  success: "badge-good",
  failed: "badge-bad",
};
const serverStatusBadge: Record<ServerDto["status"], string> = {
  connected: "badge-good",
  pending: "badge-warn",
  error: "badge-bad",
};

function metricBarClass(value: number | null, threshold: number): string {
  if (value === null) return "metric-bar-fill-neutral";
  if (value >= threshold) return "metric-bar-fill-bad";
  if (value >= threshold - 20) return "metric-bar-fill-warn";
  return "metric-bar-fill-good";
}

async function loadOverview(teamId: string) {
  loadingOverview.value = true;
  try {
    const [overviewRes, serversRes] = await Promise.all([
      api.get<{ overview: TeamOverviewDto }>(`/teams/${teamId}/overview`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
    ]);
    overview.value = overviewRes.overview;
    servers.value = serversRes.servers;
  } catch {
    // Dashboard widgets are a bonus, not critical path — the team list below still works.
  } finally {
    loadingOverview.value = false;
  }
}

watch(
  primaryTeam,
  (team) => {
    if (team) loadOverview(team.id);
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Times</h1>
        <p>Cada time tem seus próprios servidores, apps e bancos.</p>
      </div>
    </div>

    <div v-if="auth.teams.length === 0" class="card">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">groups</span>
          Você ainda não tem nenhum time.
        </div>
      </div>
    </div>

    <template v-else>
      <div v-if="overview" class="quick-links mb-16">
        <div class="stat-card">
          <div class="stat-label">Aplicações</div>
          <div class="stat-value">{{ overview.counts.applications }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Bancos de dados</div>
          <div class="stat-value">{{ overview.counts.databases }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Serviços</div>
          <div class="stat-value">{{ overview.counts.services }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Servidores</div>
          <div class="stat-value">{{ overview.counts.servers }}</div>
        </div>
      </div>

      <div v-if="overview" class="grid grid-2 mb-16" style="align-items: start">
        <div class="card" style="margin-bottom: 0">
          <div class="card-header">
            <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
            Deploys recentes
          </div>
          <div v-if="overview.recentDeployments.length === 0" class="card-body">
            <div class="empty-state">Nenhum deploy ainda.</div>
          </div>
          <div v-else class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Aplicação</th>
                  <th>Quando</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="deployment in overview.recentDeployments" :key="deployment.id">
                  <td>{{ deployment.applicationName }}</td>
                  <td>{{ new Date(deployment.createdAt).toLocaleString("pt-BR") }}</td>
                  <td><span class="badge" :class="deploymentBadge[deployment.status]">{{ deployment.status }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin-bottom: 0">
          <div class="card-header">
            <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
            Servidores
          </div>
          <div v-if="servers.length === 0" class="card-body">
            <div class="empty-state">Nenhum servidor ainda.</div>
          </div>
          <div v-else class="card-body" style="display: flex; flex-direction: column; gap: 16px">
            <div v-for="server in servers" :key="server.id">
              <div class="btn-row mb-16" style="justify-content: space-between; margin-bottom: 8px">
                <strong>{{ server.name }}</strong>
                <span class="badge" :class="serverStatusBadge[server.status]">{{ server.status }}</span>
              </div>
              <div v-if="server.metricsCheckedAt" class="grid grid-3">
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
        </div>
      </div>

      <div class="quick-links mb-16">
        <RouterLink v-for="team in auth.teams" :key="team.id" :to="`/teams/${team.id}`" class="quick-link">
          <div class="name">
            {{ team.name }}
            <span class="badge badge-neutral">{{ team.role }}</span>
          </div>
          <div class="desc">{{ team.personal ? "Time pessoal" : "Time compartilhado" }}</div>
        </RouterLink>
      </div>
    </template>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Criar novo time
      </div>
      <div class="card-body">
        <form class="form-row" style="align-items: end" @submit.prevent="createTeam">
          <div class="form-group" style="margin-bottom: 0">
            <label for="team-name">Nome do time</label>
            <input id="team-name" v-model="name" class="form-control" placeholder="Ex: Minha empresa" />
          </div>
          <button type="submit" class="btn" :disabled="creating">
            {{ creating ? "criando..." : "Criar time" }}
          </button>
        </form>
        <div v-if="error" class="alert alert-error" style="margin-top: 12px">{{ error }}</div>
      </div>
    </div>
  </div>
</template>
