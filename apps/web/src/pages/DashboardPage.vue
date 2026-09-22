<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeploymentStatus, ProjectDto, ServerDto, TeamOverviewDto } from "@yeah/shared";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";

const auth = useAuthStore();

// Single-admin instances almost always have exactly one team (the personal one) — this page shows
// its overview directly, Coolify's "Root Team" dashboard style, instead of a team picker first.
// Switching to a different team (the rare multi-team case) happens from the topbar TeamSwitcher.
const primaryTeam = computed(() => auth.teams[0] ?? null);
const overview = ref<TeamOverviewDto | null>(null);
const servers = ref<ServerDto[]>([]);
const projects = ref<ProjectDto[]>([]);
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
    const [overviewRes, serversRes, projectsRes] = await Promise.all([
      api.get<{ overview: TeamOverviewDto }>(`/teams/${teamId}/overview`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
      api.get<{ projects: ProjectDto[] }>(`/teams/${teamId}/projects`),
    ]);
    overview.value = overviewRes.overview;
    servers.value = serversRes.servers;
    projects.value = projectsRes.projects;
  } catch {
    // Dashboard widgets are a bonus, not critical path.
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
        <h1>Dashboard</h1>
        <p v-if="primaryTeam">Visão geral de {{ primaryTeam.name }}.</p>
      </div>
    </div>

    <div v-if="!primaryTeam" class="card">
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

      <div v-if="overview" class="card mb-16">
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

      <div class="card-header" style="border: none; padding-left: 0; padding-right: 0">
        <span class="material-symbols-outlined" style="font-size: 18px">layers</span>
        Projetos
        <RouterLink :to="`/teams/${primaryTeam.id}`" class="label-link" style="margin-left: auto; font-size: 13px; text-transform: none; letter-spacing: normal; font-weight: 500">
          Ver todos
        </RouterLink>
      </div>
      <div v-if="projects.length === 0" class="card mb-16">
        <div class="card-body">
          <div class="empty-state">Nenhum projeto ainda.</div>
        </div>
      </div>
      <div v-else class="quick-links mb-16">
        <RouterLink v-for="project in projects" :key="project.id" :to="`/teams/${primaryTeam.id}/projects/${project.id}`" class="quick-link">
          <div class="name">
            {{ project.name }}
            <span class="badge badge-neutral">{{ project.environmentCount }} ambiente(s)</span>
          </div>
          <div class="desc">Criado em {{ new Date(project.createdAt).toLocaleDateString("pt-BR") }}</div>
        </RouterLink>
      </div>

      <div class="card-header" style="border: none; padding-left: 0; padding-right: 0">
        <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
        Servidores
        <RouterLink :to="`/teams/${primaryTeam.id}/servers`" class="label-link" style="margin-left: auto; font-size: 13px; text-transform: none; letter-spacing: normal; font-weight: 500">
          Ver todos
        </RouterLink>
      </div>
      <div v-if="servers.length === 0" class="card">
        <div class="card-body">
          <div class="empty-state">Nenhum servidor ainda.</div>
        </div>
      </div>
      <div v-else class="resource-cards">
        <div v-for="server in servers" :key="server.id" class="resource-card">
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
    </template>
  </div>
</template>
