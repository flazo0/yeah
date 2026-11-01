<script setup lang="ts">
import { ref, watch } from "vue";
import { joinBrowserPath, parentBrowserPath, type BrowserEntry } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

// Container file browser shared by applications, services (one container of the stack) and
// databases. Reading always works; the write controls only appear when the instance allows writes.

const props = defineProps<{ basePath: string; container?: string }>();
const emit = defineEmits<{ error: [message: string] }>();

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});

const path = ref("/");
const entries = ref<BrowserEntry[]>([]);
const loading = ref(false);
const writable = ref(false);
const maxUploadBytes = ref(10 * 1024 * 1024);
const file = ref<{ path: string; content: string; binary: boolean; truncated: boolean; editable: boolean } | null>(null);
const editing = ref(false);
const draft = ref("");
const busy = ref(false);
const notice = ref("");
const uploadInput = ref<HTMLInputElement | null>(null);

const q = (extra = "") => `${props.container ? `container=${encodeURIComponent(props.container)}` : ""}${extra}`;
const withQuery = (base: string, ...parts: string[]) => {
  const s = parts.filter(Boolean).join("&");
  return s ? `${base}?${s}` : base;
};
const fail = (err: unknown, fallbackKey: string) => emit("error", err instanceof ApiError ? err.message : t(fallbackKey));

function size(n: number | null): string {
  if (n === null) return "";
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

async function open(dir: string) {
  loading.value = true;
  emit("error", "");
  notice.value = "";
  file.value = null;
  editing.value = false;
  try {
    const res = await api.get<{ path: string; entries: BrowserEntry[]; writable: boolean; maxUploadBytes: number }>(
      withQuery(`${props.basePath}/files`, `path=${encodeURIComponent(dir)}`, q()),
    );
    path.value = res.path;
    entries.value = res.entries;
    writable.value = res.writable;
    maxUploadBytes.value = res.maxUploadBytes;
  } catch (err) {
    entries.value = [];
    fail(err, "applicationFiles.failedListFolder");
  } finally {
    loading.value = false;
  }
}

async function openFile(name: string) {
  const target = joinBrowserPath(path.value, name);
  loading.value = true;
  emit("error", "");
  notice.value = "";
  try {
    file.value = await api.get(withQuery(`${props.basePath}/files/content`, `path=${encodeURIComponent(target)}`, "edit=1", q()));
    editing.value = false;
  } catch (err) {
    fail(err, "applicationFiles.failedReadFile");
  } finally {
    loading.value = false;
  }
}

function click(e: BrowserEntry) {
  if (e.kind === "dir") void open(joinBrowserPath(path.value, e.name));
  else if (e.kind === "file" || e.kind === "link") void openFile(e.name);
}

function startEdit() {
  if (!file.value) return;
  draft.value = file.value.content;
  editing.value = true;
}

async function save() {
  if (!file.value) return;
  busy.value = true;
  emit("error", "");
  try {
    await api.put(withQuery(`${props.basePath}/file-save`, q()), { path: file.value.path, content: draft.value });
    file.value.content = draft.value;
    editing.value = false;
    notice.value = t("applicationFiles.saved");
  } catch (err) {
    fail(err, "applicationFiles.failedSave");
  } finally {
    busy.value = false;
  }
}

async function newFolder() {
  const name = prompt(t("applicationFiles.folderName"));
  if (!name) return;
  busy.value = true;
  emit("error", "");
  try {
    await api.post(withQuery(`${props.basePath}/file-mkdir`, q()), { path: joinBrowserPath(path.value, name) });
    await open(path.value);
  } catch (err) {
    fail(err, "applicationFiles.failedCreateFolder");
  } finally {
    busy.value = false;
  }
}

async function newFile() {
  const name = prompt(t("applicationFiles.fileName"));
  if (!name) return;
  busy.value = true;
  emit("error", "");
  try {
    const target = joinBrowserPath(path.value, name);
    await api.put(withQuery(`${props.basePath}/file-save`, q()), { path: target, content: "", create: true });
    await open(path.value);
    await openFile(name);
    startEdit();
  } catch (err) {
    fail(err, "applicationFiles.failedSave");
  } finally {
    busy.value = false;
  }
}

async function remove(target: string) {
  if (!confirm(t("applicationFiles.confirmDelete", { path: target }))) return;
  busy.value = true;
  emit("error", "");
  try {
    await api.post(withQuery(`${props.basePath}/file-delete`, q()), { path: target, confirm: target });
    await open(path.value);
  } catch (err) {
    fail(err, "applicationFiles.failedDelete");
  } finally {
    busy.value = false;
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function upload(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const chosen = input.files?.[0];
  input.value = "";
  if (!chosen) return;
  if (chosen.size > maxUploadBytes.value) {
    emit("error", t("applicationFiles.uploadTooLarge", { max: size(maxUploadBytes.value) }));
    return;
  }
  const exists = entries.value.some((e) => e.name === chosen.name);
  if (exists && !confirm(t("applicationFiles.confirmOverwrite", { name: chosen.name }))) return;
  busy.value = true;
  emit("error", "");
  try {
    await api.post(withQuery(`${props.basePath}/file-upload`, q()), {
      dir: path.value,
      name: chosen.name,
      contentBase64: toBase64(await chosen.arrayBuffer()),
      overwrite: exists,
    });
    notice.value = t("applicationFiles.uploaded", { name: chosen.name });
    await open(path.value);
  } catch (err) {
    fail(err, "applicationFiles.failedUpload");
  } finally {
    busy.value = false;
  }
}

// Another container of the stack is another filesystem: start again from the root.
watch(
  () => props.container,
  () => {
    void open("/");
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <p class="hint mb-16">{{ writable ? $t("applicationFiles.hintWritable") : $t("applicationFiles.hint") }}</p>
    <p v-if="!writable" class="hint mb-16">{{ $t("applicationFiles.writesDisabled") }}</p>
    <p class="mono mb-16">{{ path }}</p>
    <div class="btn-row mb-16">
      <button type="button" class="btn btn-secondary btn-sm" :disabled="loading || path === '/'" @click="open(parentBrowserPath(path))">
        <span class="material-symbols-outlined" style="font-size: 16px">arrow_upward</span>
        {{ $t("applicationFiles.up") }}
      </button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="open(path)">{{ $t("applicationFiles.refresh") }}</button>
      <template v-if="writable">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading || busy" @click="newFile">{{ $t("applicationFiles.newFile") }}</button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading || busy" @click="newFolder">{{ $t("applicationFiles.newFolder") }}</button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading || busy" @click="uploadInput?.click()">{{ $t("applicationFiles.upload") }}</button>
        <input ref="uploadInput" type="file" style="display: none" @change="upload" />
      </template>
    </div>
    <p v-if="notice" class="hint mb-16">{{ notice }}</p>

    <div v-if="file" class="mb-16">
      <div class="stat-label mono">{{ file.path }}</div>
      <p v-if="file.binary" class="hint">{{ $t("applicationFiles.binaryFileCannotShownHere") }}</p>
      <template v-else>
        <p v-if="file.truncated" class="hint">{{ $t("applicationFiles.truncado") }}</p>
        <textarea v-if="editing" v-model="draft" class="mono" spellcheck="false" style="width: 100%; min-height: 320px" :disabled="busy"></textarea>
        <pre v-else class="callout-code" style="max-height: 420px; overflow: auto; margin: 0">{{ file.content }}</pre>
      </template>
      <div class="btn-row" style="margin-top: 8px">
        <template v-if="editing">
          <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="save">{{ $t("applicationFiles.save") }}</button>
          <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="editing = false">{{ $t("applicationFiles.cancel") }}</button>
        </template>
        <template v-else>
          <button v-if="writable && file.editable && !file.binary && !file.truncated" type="button" class="btn btn-secondary btn-sm" @click="startEdit">{{ $t("applicationFiles.edit") }}</button>
          <button v-if="writable" type="button" class="btn btn-danger btn-sm" :disabled="busy" @click="remove(file.path)">{{ $t("applicationFiles.delete") }}</button>
          <button type="button" class="btn btn-secondary btn-sm" @click="file = null">{{ $t("applicationFiles.closeFile") }}</button>
        </template>
      </div>
    </div>

    <div v-if="!loading && !entries.length && !file" class="empty-state">{{ $t("applicationFiles.emptyFolder") }}</div>
    <div v-else-if="entries.length && !file" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ $t("applicationFiles.name") }}</th>
            <th>{{ $t("applicationFiles.size") }}</th>
            <th v-if="writable"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.name" :style="e.kind === 'dir' || e.kind === 'file' || e.kind === 'link' ? 'cursor: pointer' : ''" @click="click(e)">
            <td class="mono">
              <span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle">{{ e.kind === "dir" ? "folder" : e.kind === "link" ? "link" : "description" }}</span>
              {{ e.name }}
            </td>
            <td class="mono">{{ size(e.size) }}</td>
            <td v-if="writable" style="text-align: right">
              <button type="button" class="btn btn-danger btn-sm" :disabled="busy" @click.stop="remove(joinBrowserPath(path, e.name))">{{ $t("applicationFiles.delete") }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
