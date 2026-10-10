<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { RegistryDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import { i18n } from "../lib/i18n";

const teamId = useRoute().params.teamId as string;

const registries = ref<RegistryDto[]>([]);
const loading = ref(true);
const error = ref("");
const form = ref({ name: "", host: "", username: "", password: "" });
const editingId = ref<string | null>(null);
const submitting = ref(false);
const confirmingId = ref<string | null>(null);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

const presets = [
  { label: "Docker Hub", host: "docker.io" },
  { label: "GitHub (GHCR)", host: "ghcr.io" },
  { label: "GitLab", host: "registry.gitlab.com" },
];

async function load() {
  try {
    registries.value = (await api.get<{ registries: RegistryDto[] }>(`/teams/${teamId}/registries`)).registries;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("registries.falhaAoCarregarOsRegistries");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function startEdit(r: RegistryDto) {
  editingId.value = r.id;
  form.value = { name: r.name, host: r.host, username: r.username, password: "" };
}
function reset() {
  editingId.value = null;
  form.value = { name: "", host: "", username: "", password: "" };
}

async function save() {
  submitting.value = true;
  error.value = "";
  try {
    if (editingId.value) await api.put(`/teams/${teamId}/registries/${editingId.value}`, form.value);
    else await api.post(`/teams/${teamId}/registries`, form.value);
    reset();
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("registries.falhaAoSalvar");
  } finally {
    submitting.value = false;
  }
}

async function remove(r: RegistryDto) {
  if (confirmingId.value !== r.id) {
    confirmingId.value = r.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingId.value = null), 3000);
    return;
  }
  try {
    await api.delete(`/teams/${teamId}/registries/${r.id}`);
    registries.value = registries.value.filter((x) => x.id !== r.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("registries.falhaAoRemover");
  } finally {
    confirmingId.value = null;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("registries.registries") }}</h1>
        <p>{{ $t("registries.registriesDeContainersPrivadosAplica") }}</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <PageState :loading="loading" :empty="registries.length === 0" empty-icon="inventory_2" :empty-text="$t('registries.nenhumRegistryAinda')">
      <div class="card mb-16">
        <div class="table-wrap">
          <table>
            <thead><tr><th>{{ $t("registries.nome") }}</th><th>{{ $t("registries.endereco") }}</th><th>{{ $t("registries.usuario") }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="r in registries" :key="r.id">
                <td>{{ r.name }}</td>
                <td class="mono">{{ r.host }}</td>
                <td class="mono">{{ r.username }}</td>
                <td>
                  <div class="btn-row">
                    <button type="button" class="btn btn-secondary btn-sm" @click="startEdit(r)">{{ $t("registries.editar") }}</button>
                    <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="remove(r)">{{ confirmingId === r.id ? $t('common.confirmQ') : $t('common.remove') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </PageState>

    <form class="card" style="margin-bottom: 0" @submit.prevent="save">
      <div class="card-header">{{ editingId ? $t("registries.editarRegistry") : $t("registries.novoRegistry") }}</div>
      <div class="card-body">
        <div v-if="!editingId" class="btn-row mb-16">
          <button v-for="p in presets" :key="p.host" type="button" class="btn btn-secondary btn-sm" @click="form.host = p.host; form.name ||= p.label">{{ p.label }}</button>
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="reg-name">{{ $t("registries.nome") }}</label>
            <input id="reg-name" v-model="form.name" class="form-control" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="reg-host">{{ $t("registries.endereco") }}</label>
            <input id="reg-host" v-model="form.host" class="form-control mono" :placeholder="$t('registries.ghcrIo')" required />
          </div>
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="reg-user">{{ $t("registries.usuario") }}</label>
            <input id="reg-user" v-model="form.username" class="form-control mono" autocomplete="off" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="reg-pass">{{ $t("registries.senhaOuToken") }}</label>
            <input id="reg-pass" v-model="form.password" type="password" class="form-control" autocomplete="new-password" :required="!editingId" :placeholder="editingId ? 'em branco = manter a atual' : ''" />
          </div>
        </div>
        <p class="hint mb-16">{{ $t("registries.aSenhaFicaCriptografadaNo") }}</p>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="submitting">{{ editingId ? "Salvar" : $t("registries.adicionarRegistry") }}</button>
          <button v-if="editingId" type="button" class="btn btn-secondary" @click="reset">{{ $t("registries.cancelar") }}</button>
        </div>
      </div>
    </form>
  </div>
</template>
