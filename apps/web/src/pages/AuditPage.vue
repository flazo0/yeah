<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { AuditEventDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import { dateLocale, i18n } from "../lib/i18n";

const route = useRoute();
const teamId = route.params.teamId as string;

const events = ref<AuditEventDto[]>([]);
const nextBefore = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
const onlyWarnings = ref(false);

const TYPE_LABEL = computed<Record<string, string>>(() => ({
  server: i18n.global.t("audit.tipoServidor"),
  application: i18n.global.t("audit.tipoAplicacao"),
  service: i18n.global.t("audit.tipoServico"),
  database: i18n.global.t("audit.tipoBanco"),
  project: i18n.global.t("audit.tipoProjeto"),
}));

function query(before: string | null): string {
  const params = new URLSearchParams({ limit: "50" });
  if (before) params.set("before", before);
  if (onlyWarnings.value) params.set("level", "warning");
  return params.toString();
}

async function load(more = false) {
  if (more) loadingMore.value = true;
  else loading.value = true;
  error.value = "";
  try {
    const res = await api.get<{ events: AuditEventDto[]; nextBefore: string | null }>(`/teams/${teamId}/audit?${query(more ? nextBefore.value : null)}`);
    events.value = more ? [...events.value, ...res.events] : res.events;
    nextBefore.value = res.nextBefore;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("audit.falha");
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

onMounted(() => load());
</script>

<template>
  <PageState v-if="loading" loading />
  <div v-else>
    <div class="page-header">
      <h1>{{ $t("audit.titulo") }}</h1>
    </div>
    <p class="hint mb-16">{{ $t("audit.dica") }}</p>
    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
    <div class="form-group mb-16" style="display: flex; align-items: center; gap: 8px">
      <input id="audit-warnings" v-model="onlyWarnings" type="checkbox" @change="load()" />
      <label for="audit-warnings" style="margin: 0">{{ $t("audit.somenteAtencao") }}</label>
    </div>
    <div v-if="!events.length" class="empty-state">{{ $t("audit.vazio") }}</div>
    <div v-else class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>{{ $t("audit.quando") }}</th><th>{{ $t("audit.quem") }}</th><th>{{ $t("audit.oQue") }}</th><th>{{ $t("audit.recurso") }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in events" :key="e.id">
              <td>{{ new Date(e.createdAt).toLocaleString(dateLocale()) }}</td>
              <td>{{ e.actor ?? "—" }}</td>
              <td>
                <span v-if="e.level === 'warning'" class="badge badge-warn" style="margin-right: 6px">{{ $t("audit.atencao") }}</span>
                {{ e.action }}
              </td>
              <td>
                <span v-if="e.resourceName" class="mono">{{ e.resourceName }}</span>
                <span v-else-if="e.resourceId" class="muted mono" :title="e.resourceId">{{ $t("audit.removido") }}</span>
                <span v-if="TYPE_LABEL[e.resourceType]" class="muted"> ({{ TYPE_LABEL[e.resourceType] }})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-if="nextBefore" class="btn-row" style="margin-top: 12px">
      <button type="button" class="btn btn-secondary" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? $t("audit.carregando") : $t("audit.maisAntigos") }}</button>
    </div>
  </div>
</template>
