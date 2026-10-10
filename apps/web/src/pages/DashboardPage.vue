<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DeploymentStatus, ProjectDto, ServerDto, TeamOverviewDto } from "@yeah/shared";
import { useAuthStore } from "../stores/auth";
import { api } from "../lib/api";
import StatusBadge from "../components/StatusBadge.vue";
import { dateLocale } from "../lib/i18n";

const auth = useAuthStore();

// Single-admin instances almost always have exactly one team (the personal one) — this page shows
// its overview directly, Coolify's "Root Team" dashboard style, instead of a team picker first.
// Switching to a different team (the rare multi-team case) happens from the topbar TeamSwitcher.
const primaryTeam = computed(() => auth.teams[0] ?? null);
const overview = ref<TeamOverviewDto | null>(null);
const servers = ref<ServerDto[]>([]);
const projects = ref<ProjectDto[]>([]);
const loadingOverview = ref(false);
const cpuHistoryByServer = ref<Record<string, number[]>>({});

function metricBarClass(value: number | null, threshold: number): string {
  if (value === null) return "metric-bar-fill-neutral";
  if (value >= threshold) return "metric-bar-fill-bad";
  if (value >= threshold - 20) return "metric-bar-fill-warn";
  return "metric-bar-fill-good";
}

/** Points for a tiny SVG polyline in a 100x24 box — CPU-only, just enough to show a trend at a glance. */
function sparkPoints(serverId: string): string {
  const values = cpuHistoryByServer.value[serverId] ?? [];
  if (values.length < 2) return "";
  return values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(24 - (Math.min(100, v) / 100) * 22 - 1).toFixed(1)}`).join(" ");
}

async function loadOverview(teamId: string) {
  loadingOverview.value = true;
  try {
    const [overviewRes, serversRes, projectsRes, historyRes] = await Promise.all([
      api.get<{ overview: TeamOverviewDto }>(`/teams/${teamId}/overview`),
      api.get<{ servers: ServerDto[] }>(`/teams/${teamId}/servers`),
      api.get<{ projects: ProjectDto[] }>(`/teams/${teamId}/projects`),
      api.get<{ history: Record<string, { at: string; cpu: number }[]> }>(`/teams/${teamId}/servers/metrics-history?hours=24`),
    ]);
    overview.value = overviewRes.overview;
    servers.value = serversRes.servers;
    projects.value = projectsRes.projects;
    cpuHistoryByServer.value = Object.fromEntries(Object.entries(historyRes.history).map(([id, points]) => [id, points.map((p) => p.cpu)]));
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
        <h1>{{ $t("dashboard.dashboard") }}</h1>
        <p v-if="primaryTeam">{{ $t("dashboard.visaoGeralDeP0", { p0: primaryTeam.name }) }}</p>
      </div>
    </div>

    <div v-if="!primaryTeam" class="card">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">groups</span>
          {{ $t("dashboard.voceAindaNaoTemNenhum") }}
        </div>
      </div>
    </div>

    <template v-else>
      <div v-if="overview" class="quick-links mb-16">
        <div class="stat-card">
          <div class="stat-label">{{ $t("dashboard.aplicacoes") }}</div>
          <div class="stat-value">{{ overview.counts.applications }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ $t("dashboard.bancosDeDados") }}</div>
          <div class="stat-value">{{ overview.counts.databases }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ $t("dashboard.servicos") }}</div>
          <div class="stat-value">{{ overview.counts.services }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ $t("dashboard.servidores") }}</div>
          <div class="stat-value">{{ overview.counts.servers }}</div>
        </div>
      </div>

      <div v-if="overview" class="card mb-16">
        <div class="card-header">
          <span class="material-symbols-outlined" style="font-size: 18px">rocket_launch</span>
          {{ $t("dashboard.deploysRecentes") }}
        </div>
        <div v-if="overview.recentDeployments.length === 0" class="card-body">
          <div class="empty-state">{{ $t("dashboard.nenhumDeployAinda") }}</div>
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ $t("dashboard.aplicacao") }}</th>
                <th>{{ $t("dashboard.quando") }}</th>
                <th>{{ $t("dashboard.status") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="deployment in overview.recentDeployments" :key="deployment.id">
                <td>{{ deployment.applicationName }}</td>
                <td>{{ new Date(deployment.createdAt).toLocaleString(dateLocale()) }}</td>
                <td><StatusBadge :status="deployment.status" kind="job" /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card-header" style="border: none; padding-left: 0; padding-right: 0">
        <span class="material-symbols-outlined" style="font-size: 18px">layers</span>
        {{ $t("dashboard.projetos") }}
        <RouterLink :to="`/teams/${primaryTeam.id}`" class="label-link" style="margin-left: auto; font-size: 13px; text-transform: none; letter-spacing: normal; font-weight: 500">
          {{ $t("dashboard.verTodos") }}
        </RouterLink>
      </div>
      <div v-if="projects.length === 0" class="card mb-16">
        <div class="card-body">
          <div class="empty-state">{{ $t("dashboard.nenhumProjetoAinda") }}</div>
        </div>
      </div>
      <div v-else class="quick-links mb-16">
        <RouterLink v-for="project in projects" :key="project.id" :to="`/teams/${primaryTeam.id}/projects/${project.id}`" class="quick-link">
          <div class="name">
            {{ project.name }}
            <span class="badge badge-neutral">{{ $t("dashboard.p0AmbienteS", { p0: project.environmentCount }) }}</span>
          </div>
          <div class="desc">{{ $t("dashboard.criadoEmP0", { p0: new Date(project.createdAt).toLocaleDateString(dateLocale()) }) }}</div>
        </RouterLink>
      </div>

      <div class="card-header" style="border: none; padding-left: 0; padding-right: 0">
        <span class="material-symbols-outlined" style="font-size: 18px">dns</span>
        {{ $t("dashboard.servidores") }}
        <RouterLink :to="`/teams/${primaryTeam.id}/servers`" class="label-link" style="margin-left: auto; font-size: 13px; text-transform: none; letter-spacing: normal; font-weight: 500">
          {{ $t("dashboard.verTodos") }}
        </RouterLink>
      </div>
      <div v-if="servers.length === 0" class="card">
        <div class="card-body">
          <div class="empty-state">{{ $t("dashboard.nenhumServidorAinda") }}</div>
        </div>
      </div>
      <div v-else class="resource-cards">
        <div v-for="server in servers" :key="server.id" class="resource-card">
          <div class="btn-row mb-16" style="justify-content: space-between; margin-bottom: 8px">
            <strong>{{ server.name }}</strong>
            <StatusBadge :status="server.status" />
          </div>
          <div v-if="server.metricsCheckedAt" class="grid grid-3">
            <div>
              <div class="stat-label">{{ $t("dashboard.cpuP0", { p0: server.cpuPercent }) }}</div>
              <div class="metric-bar"><div class="metric-bar-fill" :class="metricBarClass(server.cpuPercent, 90)" :style="{ width: `${server.cpuPercent}%` }"></div></div>
            </div>
            <div>
              <div class="stat-label">{{ $t("dashboard.ramP0", { p0: server.memPercent }) }}</div>
              <div class="metric-bar"><div class="metric-bar-fill" :class="metricBarClass(server.memPercent, 90)" :style="{ width: `${server.memPercent}%` }"></div></div>
            </div>
            <div>
              <div class="stat-label">{{ $t("dashboard.discoP0", { p0: server.diskPercent }) }}</div>
              <div class="metric-bar"><div class="metric-bar-fill" :class="metricBarClass(server.diskPercent, 85)" :style="{ width: `${server.diskPercent}%` }"></div></div>
            </div>
          </div>
          <svg v-if="sparkPoints(server.id)" viewBox="0 0 100 24" preserveAspectRatio="none" class="spark" style="margin-top: 8px" aria-hidden="true">
            <polyline :points="sparkPoints(server.id)" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
    </template>
  </div>
</template>
