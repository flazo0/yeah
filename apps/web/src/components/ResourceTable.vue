<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PageState from "./PageState.vue";
import StatusBadge from "./StatusBadge.vue";
import { statusTone } from "../lib/status";
import ViewToggle from "./ViewToggle.vue";
import ListPager from "./ListPager.vue";

export interface ResourceRow {
  id: string;
  kind: "application" | "database" | "service";
  name: string;
  icon: string;
  typeLabel: string;
  status: string;
  domain: string | null;
  serverName: string;
  detail: string;
  path: string;
  tags?: { id: string; name: string; color: string }[];
}

const props = defineProps<{
  items: ResourceRow[];
  loading?: boolean;
  pendingDeleteId?: string | null;
}>();
const emit = defineEmits<{ delete: [row: ResourceRow]; tags: [row: ResourceRow] }>();

const view = ref<"list" | "grid">("list");
const pageSize = ref(10);
const page = ref(1);
const search = ref("");
const typeFilter = ref("");
const statusFilter = ref("");
const serverFilter = ref("");
const tagFilter = ref("");
const sortBy = ref<"name" | "status" | "type" | "server">("name");

watch([search, typeFilter, statusFilter, serverFilter, tagFilter, sortBy], () => {
  page.value = 1;
});

const statuses = computed(() => [...new Set(props.items.map((i) => i.status))].sort());
const allTags = computed(() => {
  const seen = new Map<string, string>();
  for (const item of props.items) for (const tag of item.tags ?? []) seen.set(tag.id, tag.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
});
const servers = computed(() => [...new Set(props.items.map((i) => i.serverName))].sort());

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const rows = props.items.filter((i) => {
    if (typeFilter.value && i.kind !== typeFilter.value) return false;
    if (statusFilter.value && i.status !== statusFilter.value) return false;
    if (serverFilter.value && i.serverName !== serverFilter.value) return false;
    if (tagFilter.value && !(i.tags ?? []).some((tag) => tag.id === tagFilter.value)) return false;
    if (!q) return true;
    return [i.name, i.typeLabel, i.domain ?? "", i.serverName, i.detail, ...(i.tags ?? []).map((tag) => tag.name)].some((f) => f.toLowerCase().includes(q));
  });
  const key = {
    name: (r: ResourceRow) => r.name,
    status: (r: ResourceRow) => r.status,
    type: (r: ResourceRow) => r.typeLabel,
    server: (r: ResourceRow) => r.serverName,
  }[sortBy.value];
  return rows.sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name));
});

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});
const hasFilters = computed(() => Boolean(search.value || typeFilter.value || statusFilter.value || serverFilter.value || tagFilter.value));

function clearFilters() {
  search.value = "";
  typeFilter.value = "";
  statusFilter.value = "";
  serverFilter.value = "";
  tagFilter.value = "";
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
        <select v-if="allTags.length > 0" v-model="tagFilter" class="form-control" aria-label="Filtrar por etiqueta">
          <option value="">Todas as etiquetas</option>
          <option v-for="tag in allTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
        <select v-model="sortBy" class="form-control" aria-label="Ordenar por">
          <option value="name">Ordenar: nome</option>
          <option value="status">Ordenar: status</option>
          <option value="type">Ordenar: tipo</option>
          <option value="server">Ordenar: servidor</option>
        </select>
      </div>
      <ViewToggle v-model="view" storage-key="yeah:resource-view" />
    </div>

    <PageState v-if="loading" loading />
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
                <div v-if="row.tags?.length" class="tag-chips">
                  <span v-for="tag in row.tags" :key="tag.id" class="tag-chip" :style="{ '--tag': tag.color }">{{ tag.name }}</span>
                </div>
              </td>
              <td data-label="Tipo">{{ row.typeLabel }}</td>
              <td data-label="Status">
                <StatusBadge :status="row.status" />
              </td>
              <td data-label="Domínio" class="rtable-domain">
                <a v-if="row.domain" :href="domainHref(row.domain)" target="_blank" rel="noopener noreferrer" class="mono">{{ row.domain }}</a>
                <span v-else class="muted">-</span>
              </td>
              <td data-label="Servidor">{{ row.serverName }}</td>
              <td class="rtable-actions-col">
                <button type="button" class="rtable-delete" title="Etiquetas" aria-label="Etiquetas" @click="emit('tags', row)">
                  <span class="material-symbols-outlined">sell</span>
                </button>
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
              <span class="status-dot" :class="`status-dot-${statusTone(row.status)}`"></span>
              <span class="material-symbols-outlined" style="font-size: 16px">{{ row.icon }}</span>
              {{ row.name }}
              <StatusBadge :status="row.status" style="margin-left: auto" />
            </div>
            <div class="desc mono">{{ row.detail }}</div>
            <div class="desc">{{ row.domain || row.serverName }}</div>
            <div v-if="row.tags?.length" class="tag-chips">
              <span v-for="tag in row.tags" :key="tag.id" class="tag-chip" :style="{ '--tag': tag.color }">{{ tag.name }}</span>
            </div>
          </RouterLink>
          <button type="button" class="resource-card-delete resource-card-tags" title="Etiquetas" aria-label="Etiquetas" @click="emit('tags', row)">
            <span class="material-symbols-outlined">sell</span>
          </button>
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

      <ListPager v-model:page="page" v-model:page-size="pageSize" :total="filtered.length" size-key="yeah:resource-page-size" />
    </template>
  </div>
</template>
