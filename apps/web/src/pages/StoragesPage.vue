<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import type { S3StorageDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";

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
    error.value = err instanceof ApiError ? err.message : "falha ao carregar destinos de armazenamento";
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
    error.value = err instanceof ApiError ? err.message : "falha ao criar destino de armazenamento";
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
        <h1>Armazenamento</h1>
        <p>Destinos S3-compatíveis pra guardar backups fora do servidor (AWS S3, MinIO, R2, Spaces...).</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">cloud</span>
        Destinos do time
      </div>
      <div v-if="loading" class="card-body">
        <PageState loading />
      </div>
      <div v-else-if="storages.length === 0" class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">cloud_off</span>
          Nenhum destino ainda. Sem isso, os backups ficam só no disco do servidor.
        </div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Bucket</th>
              <th>Endpoint</th>
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
                  {{ testingId === storage.id ? "testando..." : "testar" }}
                </button>
                <span v-if="testResult[storage.id] === 'ok'" class="badge badge-good">ok</span>
                <span v-else-if="testResult[storage.id] === 'failed'" class="badge badge-bad">falhou</span>
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
        Adicionar destino
      </div>
      <div class="card-body">
        <form @submit.prevent="addStorage">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-name">Nome</label>
              <input id="storage-name" v-model="form.name" class="form-control" placeholder="backups-producao" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-bucket">Bucket</label>
              <input id="storage-bucket" v-model="form.bucket" class="form-control" placeholder="meus-backups" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-region">Região</label>
              <input id="storage-region" v-model="form.region" class="form-control" placeholder="us-east-1" />
            </div>
          </div>
          <div class="form-group">
            <label for="storage-endpoint">Endpoint (deixe em branco pra AWS S3 de verdade)</label>
            <input id="storage-endpoint" v-model="form.endpoint" class="form-control mono" placeholder="https://minha-instancia-minio:9000" />
          </div>
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-key">Access Key ID</label>
              <input id="storage-key" v-model="form.accessKeyId" class="form-control mono" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="storage-secret">Secret Access Key</label>
              <input id="storage-secret" v-model="form.secretAccessKey" type="password" class="form-control mono" required />
            </div>
          </div>
          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? "adicionando..." : "Adicionar destino" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
