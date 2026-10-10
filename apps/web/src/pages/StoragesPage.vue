<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import type { S3StorageDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import { i18n } from "../lib/i18n";

const route = useRoute();
const teamId = route.params.teamId as string;

const storages = ref<S3StorageDto[]>([]);
const loading = ref(true);
const error = ref("");

const form = ref({ name: "", endpoint: "", region: "us-east-1", bucket: "", accessKeyId: "", secretAccessKey: "" });
const submitting = ref(false);
const testingId = ref<string | null>(null);
const testResult = ref<Record<string, "ok" | "failed">>({});

async function loadStorages() {
  loading.value = true;
  try {
    const res = await api.get<{ storages: S3StorageDto[] }>(`/teams/${teamId}/storages`);
    storages.value = res.storages;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("storages.falhaAoCarregarDestinosDe");
  } finally {
    loading.value = false;
  }
}

async function addStorage() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ storage: S3StorageDto }>(`/teams/${teamId}/storages`, {
      ...form.value,
      endpoint: form.value.endpoint || undefined,
    });
    storages.value.push(res.storage);
    form.value = { name: "", endpoint: "", region: "us-east-1", bucket: "", accessKeyId: "", secretAccessKey: "" };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("storages.falhaAoCriarDestinoDe");
  } finally {
    submitting.value = false;
  }
}

async function testConnection(storageId: string) {
  testingId.value = storageId;
  delete testResult.value[storageId];
  try {
    const res = await api.post<{ ok: boolean; error?: string }>(`/teams/${teamId}/storages/${storageId}/test-connection`);
    testResult.value = { ...testResult.value, [storageId]: res.ok ? "ok" : "failed" };
    if (!res.ok && res.error) error.value = res.error;
  } finally {
    testingId.value = null;
  }
}

async function deleteStorage(storageId: string) {
  await api.delete(`/teams/${teamId}/storages/${storageId}`);
  storages.value = storages.value.filter((s) => s.id !== storageId);
}

onMounted(loadStorages);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("storages.armazenamento") }}</h1>
        <p>{{ $t("storages.destinosS3CompativeisPraGuardar") }}</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">cloud</span>
        {{ $t("storages.destinosDoTime") }}
      </div>
      <div v-if="loading" class="card-body">
        <PageState loading />
      </div>
      <div v-else-if="storages.length === 0" class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">cloud_off</span>
          {{ $t("storages.nenhumDestinoAindaSemIsso") }}
        </div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ $t("storages.nome") }}</th>
              <th>{{ $t("storages.bucket") }}</th>
              <th>{{ $t("storages.endpoint") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="storage in storages" :key="storage.id">
              <td><strong>{{ storage.name }}</strong></td>
              <td class="mono">{{ storage.bucket }} ({{ storage.region }})</td>
              <td class="mono">{{ storage.endpoint || "AWS S3" }}</td>
              <td class="btn-row">
                <button type="button" class="btn btn-secondary btn-sm" :disabled="testingId === storage.id" @click="testConnection(storage.id)">
                  <span class="material-symbols-outlined" style="font-size: 16px">sync</span>
                  {{ testingId === storage.id ? $t("storages.testando") : "testar" }}
                </button>
                <span v-if="testResult[storage.id] === 'ok'" class="badge badge-good">{{ $t("storages.ok") }}</span>
                <span v-else-if="testResult[storage.id] === 'failed'" class="badge badge-bad">{{ $t("storages.falhou") }}</span>
                <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteStorage(storage.id)">
                  <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        {{ $t("storages.adicionarDestino") }}
      </div>
      <div class="card-body">
        <form @submit.prevent="addStorage">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-name">{{ $t("storages.nome") }}</label>
              <input id="storage-name" v-model="form.name" class="form-control" :placeholder="$t('storages.backupsProducao')" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-bucket">{{ $t("storages.bucket") }}</label>
              <input id="storage-bucket" v-model="form.bucket" class="form-control" :placeholder="$t('storages.meusBackups')" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-region">{{ $t("storages.regiao") }}</label>
              <input id="storage-region" v-model="form.region" class="form-control" :placeholder="$t('storages.usEast1')" />
            </div>
          </div>
          <div class="form-group">
            <label for="storage-endpoint">{{ $t("storages.endpointDeixeEmBrancoPra") }}</label>
            <input id="storage-endpoint" v-model="form.endpoint" class="form-control mono" placeholder="https://minha-instancia-minio:9000" />
          </div>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-key">{{ $t("storages.accessKeyId") }}</label>
              <input id="storage-key" v-model="form.accessKeyId" class="form-control mono" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-secret">{{ $t("storages.secretAccessKey") }}</label>
              <input id="storage-secret" v-model="form.secretAccessKey" type="password" class="form-control mono" required />
            </div>
          </div>
          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? $t("storages.adicionando") : $t("storages.adicionarDestino") }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
