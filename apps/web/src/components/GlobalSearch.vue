<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { SearchResultDto } from "@yeah/shared";
import { api } from "../lib/api";

const props = defineProps<{ teamId: string | null }>();
const router = useRouter();

const open = ref(false);
const query = ref("");
const results = ref<SearchResultDto[]>([]);
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let requestId = 0;

interface Entry {
  key: string;
  name: string;
  subtitle: string;
  icon: string;
  path: string;
}

const kindIcon: Record<SearchResultDto["kind"], string> = {
  project: "layers",
  server: "dns",
  application: "deployed_code",
  database: "database",
  service: "widgets",
};

const pages = computed<Entry[]>(() => {
  const t = props.teamId;
  const list: Entry[] = [{ key: "p-dashboard", name: "Dashboard", subtitle: "Página", icon: "space_dashboard", path: "/dashboard" }];
  if (t) {
    list.push(
      { key: "p-projects", name: "Projetos", subtitle: "Página", icon: "layers", path: `/teams/${t}` },
      { key: "p-servers", name: "Servidores", subtitle: "Página", icon: "dns", path: `/teams/${t}/servers` },
      { key: "p-sources", name: "Fontes", subtitle: "Página", icon: "hub", path: `/teams/${t}/sources` },
      { key: "p-storages", name: "Armazenamento", subtitle: "Página", icon: "cloud", path: `/teams/${t}/storages` },
      { key: "p-team", name: "Time", subtitle: "Página", icon: "group", path: `/teams/${t}/team` },
      { key: "p-notifications", name: "Notificações", subtitle: "Página", icon: "notifications", path: `/teams/${t}/notifications` },
      { key: "p-updates", name: "Atualizações", subtitle: "Página", icon: "deployed_code_update", path: `/teams/${t}/updates` },
      { key: "p-settings", name: "Configurações", subtitle: "Página", icon: "settings", path: `/teams/${t}/settings` },
    );
  }
  return list;
});

const entries = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  const matchedPages = pages.value.filter((p) => !q || p.name.toLowerCase().includes(q));
  const matchedResults = results.value.map((r) => ({
    key: `${r.kind}-${r.id}`,
    name: r.name,
    subtitle: r.subtitle,
    icon: kindIcon[r.kind],
    path: r.path,
  }));
  return [...matchedResults, ...matchedPages];
});

watch(query, (q) => {
  active.value = 0;
  clearTimeout(timer);
  const term = q.trim();
  if (!term || !props.teamId) {
    results.value = [];
    return;
  }
  timer = setTimeout(async () => {
    const id = ++requestId;
    try {
      const res = await api.get<{ results: SearchResultDto[] }>(`/teams/${props.teamId}/search?q=${encodeURIComponent(term)}`);
      if (id === requestId) results.value = res.results;
    } catch {
      if (id === requestId) results.value = [];
    }
  }, 200);
});

async function show() {
  open.value = true;
  query.value = "";
  results.value = [];
  active.value = 0;
  await nextTick();
  input.value?.focus();
}
function hide() {
  open.value = false;
}
function go(entry: Entry | undefined) {
  if (!entry) return;
  hide();
  router.push(entry.path);
}

function onInputKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    active.value = Math.min(active.value + 1, entries.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    go(entries.value[active.value]);
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

function onGlobalKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (open.value) hide();
    else show();
    return;
  }
  if (event.key === "Escape" && open.value) {
    hide();
    return;
  }
  if (event.key === "/" && !open.value && !isTyping(event.target) && !event.ctrlKey && !event.metaKey) {
    const field = document.querySelector<HTMLInputElement>(".rtable-search input");
    if (field) {
      event.preventDefault();
      field.focus();
    }
  }
}

onMounted(() => document.addEventListener("keydown", onGlobalKey));
onUnmounted(() => {
  document.removeEventListener("keydown", onGlobalKey);
  clearTimeout(timer);
});
defineExpose({ show });
</script>

<template>
  <button type="button" class="search-trigger" @click="show">
    <span class="material-symbols-outlined">search</span>
    <span class="search-trigger-label">Buscar</span>
    <kbd>Ctrl K</kbd>
  </button>

  <Teleport to="body">
    <div v-if="open" class="palette-backdrop" @mousedown.self="hide">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Busca global">
        <div class="palette-input">
          <span class="material-symbols-outlined">search</span>
          <input
            ref="input"
            v-model="query"
            type="text"
            placeholder="Buscar projetos, servidores, recursos e páginas"
            aria-label="Buscar"
            autocomplete="off"
            @keydown="onInputKey"
          />
        </div>
        <ul class="palette-list">
          <li v-if="entries.length === 0" class="palette-empty">Nada encontrado.</li>
          <li
            v-for="(entry, i) in entries"
            :key="entry.key"
            class="palette-item"
            :class="{ active: i === active }"
            @mousemove="active = i"
            @click="go(entry)"
          >
            <span class="material-symbols-outlined">{{ entry.icon }}</span>
            <span class="palette-name">{{ entry.name }}</span>
            <span class="palette-sub">{{ entry.subtitle }}</span>
          </li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>
