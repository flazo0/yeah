<script setup lang="ts">
import { onMounted, ref } from "vue";
import { joinBrowserPath, parentBrowserPath, type BrowserEntry } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

const { app, basePath, error } = useApplicationContext();

const path = ref("/");
const entries = ref<BrowserEntry[]>([]);
const loading = ref(false);
const file = ref<{ path: string; content: string; binary: boolean; truncated: boolean } | null>(null);

function size(n: number | null): string {
  if (n === null) return "";
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

async function open(dir: string) {
  loading.value = true;
  error.value = "";
  file.value = null;
  try {
    const res = await api.get<{ path: string; entries: BrowserEntry[] }>(`${basePath}/files?path=${encodeURIComponent(dir)}`);
    path.value = res.path;
    entries.value = res.entries;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationFiles.falhaAoListar");
  } finally {
    loading.value = false;
  }
}

async function openFile(name: string) {
  const target = joinBrowserPath(path.value, name);
  loading.value = true;
  error.value = "";
  try {
    file.value = await api.get(`${basePath}/files/content?path=${encodeURIComponent(target)}`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationFiles.falhaAoLer");
  } finally {
    loading.value = false;
  }
}

function click(e: BrowserEntry) {
  if (e.kind === "dir") void open(joinBrowserPath(path.value, e.name));
  else if (e.kind === "file" || e.kind === "link") void openFile(e.name);
}

onMounted(() => open("/"));
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">folder_open</span>
      {{ $t("applicationFiles.titulo") }}
      <span class="mono" style="margin-left: 12px">{{ path }}</span>
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("applicationFiles.dica") }}</p>
      <div class="btn-row mb-16">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading || path === '/'" @click="open(parentBrowserPath(path))">
          <span class="material-symbols-outlined" style="font-size: 16px">arrow_upward</span>
          {{ $t("applicationFiles.subir") }}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="open(path)">{{ $t("applicationFiles.atualizar") }}</button>
      </div>

      <div v-if="file" class="mb-16">
        <div class="stat-label mono">{{ file.path }}</div>
        <p v-if="file.binary" class="hint">{{ $t("applicationFiles.binario") }}</p>
        <template v-else>
          <p v-if="file.truncated" class="hint">{{ $t("applicationFiles.truncado") }}</p>
          <pre class="callout-code" style="max-height: 420px; overflow: auto; margin: 0">{{ file.content }}</pre>
        </template>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 8px" @click="file = null">{{ $t("applicationFiles.fechar") }}</button>
      </div>

      <div v-if="!loading && !entries.length && !file" class="empty-state">{{ $t("applicationFiles.vazio") }}</div>
      <div v-else-if="entries.length && !file" class="table-wrap">
        <table>
          <thead><tr><th>{{ $t("applicationFiles.nome") }}</th><th>{{ $t("applicationFiles.tamanho") }}</th></tr></thead>
          <tbody>
            <tr v-for="e in entries" :key="e.name" :style="e.kind === 'dir' || e.kind === 'file' || e.kind === 'link' ? 'cursor: pointer' : ''" @click="click(e)">
              <td class="mono">
                <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle">{{ e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : "description" }}</span>
                {{ e.name }}
              </td>
              <td class="mono">{{ size(e.size) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
