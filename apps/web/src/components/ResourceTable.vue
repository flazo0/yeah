<script setup lang="ts">
import { computed, ref, watch } from "vue";

export interface ResourceRow {
  id: string;
  kind: "application" | "database" | "service";
  name: string;
  icon: string;
  typeLabel: string;
  status: string;
  statusDot: string;
  statusBadge: string;
  domain: string | null;
  serverName: string;
  detail: string;
  path: string;
}

const props = defineProps<{
  items: ResourceRow[];
  loading?: boolean;
  pendingDeleteId?: string | null;
}>();
const emit = defineEmits<{ delete: [row: ResourceRow] }>();

const VIEW_KEY = "yeah:resource-view";
const SIZE_KEY = "yeah:resource-page-size";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked — preference just won't persist
  }
}

const view = ref<"list" | "grid">(readStored(VIEW_KEY) === "grid" ? "grid" : "list");
const pageSize = ref(Number(readStored(SIZE_KEY)) || 10);
const page = ref(1);
const search = ref("");
const typeFilter = ref("");
const statusFilter = ref("");
const serverFilter = ref("");
const sortBy = ref<"name" | "status" | "type" | "server">("name");

watch(view, (v) => writeStored(VIEW_KEY, v));
watch(pageSize, (v) => writeStored(SIZE_KEY, String(v)));
watch([search, typeFilter, statusFilter, serverFilter, sortBy, pageSize], () => {
  page.value = 1;
});

const statuses = computed(() => [...new Set(props.items.map((i) => i.status))].sort());
const servers = computed(() => [...new Set(props.items.map((i) => i.serverName))].sort());

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const rows = props.items.filter((i) => {
    if (typeFilter.value && i.kind !== typeFilter.value) return false;
    if (statusFilter.value && i.status !== statusFilter.value) return false;
    if (serverFilter.value && i.serverName !== serverFilter.value) return false;
    if (!q) return true;
    return [i.name, i.typeLabel, i.domain ?? "", i.serverName, i.detail].some((f) => f.toLowerCase().includes(q));
  });
  const key = {
    name: (r: ResourceRow) => r.name,
    status: (r: ResourceRow) => r.status,
    type: (r: ResourceRow) => r.typeLabel,
    server: (r: ResourceRow) => r.serverName,
  }[sortBy.value];
  return rows.sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});
const rangeLabel = computed(() => {
  if (filtered.value.length === 0) return "0 de 0";
  const start = (page.value - 1) * pageSize.value + 1;
  const end = Math.min(page.value * pageSize.value, filtered.value.length);
  return `${start}-${end} de ${filtered.value.length}`;
});
const hasFilters = computed(() => Boolean(search.value || typeFilter.value || statusFilter.value || serverFilter.value));

function clearFilters() {
  search.value = "";
  typeFilter.value = "";
  statusFilter.value = "";
  serverFilter.value = "";
}

function domainHref(domain: string): string {
  return /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
}
</script>

<template>
  <div class="rtable-root">
    <div class="rtable-toolbar">
      <div class="rtable-search input-icon">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" class="form-control" type="search" placeholder="Buscar recursos" aria-label="Buscar recursos" />
      </div>
      <div class="rtable-filters">
        <select v-model="typeFilter" class="form-control" aria-label="Filtrar por tipo">
          <option value="">Todos os tipos</option>
          <option value="application">Aplicações</option>
          <option value="database">Bancos de dados</option>
          <option value="service">Serviços</option>
        </select>
        <select v-model="statusFilter" class="form-control" aria-label="Filtrar por status">
          <option value="">Todo status</option>
          <option v-for="s in statuses" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-if="servers.length > 1" v-model="serverFilter" class="form-control" aria-label="Filtrar por servidor">
          <option value="">Todos os servidores</option>
          <option v-for="s in servers" :key="s" :value="s">{{ s }}</option>
        </select>
        <select v-model="sortBy" class="form-control" aria-label="Ordenar por">
          <option value="name">Ordenar: nome</option>
          <option value="status">Ordenar: status</option>
          <option value="type">Ordenar: tipo</option>
          <option value="server">Ordenar: servidor</option>
        </select>
      </div>
      <div class="view-toggle" role="group" aria-label="Modo de exibição">
        <button type="button" :class="{ active: view === 'list' }" title="Lista" aria-label="Lista" @click="view = 'list'">
          <span class="material-symbols-outlined">view_list</span>
        </button>
        <button type="button" :class="{ active: view === 'grid' }" title="Grade" aria-label="Grade" @click="view = 'grid'">
          <span class="material-symbols-outlined">grid_view</span>
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty-state">carregando...</div>
    <div v-else-if="items.length === 0" class="empty-state"><slot name="empty">Nenhum recurso ainda.</slot></div>
    <div v-else-if="filtered.length === 0" class="empty-state">
      Nenhum recurso bate com os filtros.
      <button v-if="hasFilters" type="button" class="label-link rtable-link-btn" @click="clearFilters">Limpar filtros</button>
    </div>

    <template v-else>
      <div v-if="view === 'list'" class="rtable-wrap">
        <table class="rtable">
          <thead>
            <tr>
              <th>Recurso</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Domínio</th>
              <th>Servidor</th>
              <th class="rtable-actions-col"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in paged" :key="row.id">
              <td data-label="Recurso">
                <RouterLink :to="row.path" class="rtable-name">
                  <span class="rtable-icon"><span class="material-symbols-outlined">{{ row.icon }}</span></span>
                  <span class="rtable-name-text">
                    <strong>{{ row.name }}</strong>
                    <small class="mono">{{ row.detail }}</small>
                  </span>
                </RouterLink>
              </td>
              <td data-label="Tipo">{{ row.typeLabel }}</td>
              <td data-label="Status">
                <span class="badge" :class="row.statusBadge">{{ row.status }}</span>
              </td>
              <td data-label="Domínio" class="rtable-domain">
                <a v-if="row.domain" :href="domainHref(row.domain)" target="_blank" rel="noopener noreferrer" class="mono">{{ row.domain }}</a>
                <span v-else class="muted">-</span>
              </td>
              <td data-label="Servidor">{{ row.serverName }}</td>
              <td class="rtable-actions-col">
                <button
                  type="button"
                  class="rtable-delete"
                  :class="{ confirming: pendingDeleteId === row.id }"
                  :title="pendingDeleteId === row.id ? 'Clique de novo pra confirmar' : 'Excluir'"
                  :aria-label="pendingDeleteId === row.id ? 'Confirmar exclusão' : 'Excluir'"
                  @click="emit('delete', row)"
                >
                  <span class="material-symbols-outlined">{{ pendingDeleteId === row.id ? "warning" : "delete" }}</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="resource-cards">
        <div v-for="row in paged" :key="row.id" class="resource-card-wrap">
          <RouterLink :to="row.path" class="resource-card">
            <div class="name">
              <span class="status-dot" :class="row.statusDot"></span>
              <span class="material-symbols-outlined" style="font-size: 16px">{{ row.icon }}</span>
              {{ row.name }}
              <span class="badge" :class="row.statusBadge" style="margin-left: auto">{{ row.status }}</span>
            </div>
            <div class="desc mono">{{ row.detail }}</div>
            <div class="desc">{{ row.domain || row.serverName }}</div>
          </RouterLink>
          <button
            type="button"
            class="resource-card-delete"
            :class="{ confirming: pendingDeleteId === row.id }"
            :title="pendingDeleteId === row.id ? 'Clique de novo pra confirmar' : 'Excluir'"
            @click="emit('delete', row)"
          >
            <span class="material-symbols-outlined">{{ pendingDeleteId === row.id ? "warning" : "delete" }}</span>
          </button>
        </div>
      </div>

      <div class="rtable-pager">
        <span class="muted">{{ rangeLabel }}</span>
        <div class="rtable-pager-controls">
          <select v-model.number="pageSize" class="form-control" aria-label="Itens por página">
            <option :value="10">10</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
          </select>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" aria-label="Página anterior" @click="page--">
            <span class="material-symbols-outlined" style="font-size: 18px">chevron_left</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= pageCount" aria-label="Próxima página" @click="page++">
            <span class="material-symbols-outlined" style="font-size: 18px">chevron_right</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
