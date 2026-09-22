<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ApplicationVolumeDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { basePath, error } = useApplicationContext();

const volumes = ref<ApplicationVolumeDto[]>([]);
const newVolumeName = ref("");
const newVolumeMountPath = ref("");
const addingVolume = ref(false);
const deletingVolumeId = ref<string | null>(null);

async function load() {
  try {
    const res = await api.get<{ volumes: ApplicationVolumeDto[] }>(`${basePath}/volumes`);
    volumes.value = res.volumes;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar armazenamento";
  }
}
onMounted(load);

async function addVolume() {
  if (!newVolumeName.value.trim() || !newVolumeMountPath.value.trim()) return;
  addingVolume.value = true;
  error.value = "";
  try {
    const res = await api.post<{ volume: ApplicationVolumeDto }>(`${basePath}/volumes`, {
      name: newVolumeName.value.trim(),
      mountPath: newVolumeMountPath.value.trim(),
    });
    volumes.value = [...volumes.value, res.volume];
    newVolumeName.value = "";
    newVolumeMountPath.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao adicionar armazenamento";
  } finally {
    addingVolume.value = false;
  }
}

async function deleteVolume(volumeId: string) {
  deletingVolumeId.value = volumeId;
  error.value = "";
  try {
    await api.delete(`${basePath}/volumes/${volumeId}`);
    volumes.value = volumes.value.filter((v) => v.id !== volumeId);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover armazenamento";
  } finally {
    deletingVolumeId.value = null;
  }
}
</script>

<template>
  <div class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">hard_drive</span>
      Armazenamento persistente
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Volumes nomeados do Docker montados no container — sobrevivem a redeploys. Aplica no próximo deploy.
      </p>
      <div v-if="volumes.length === 0" class="empty-state">Nenhum volume configurado.</div>
      <div v-else class="table-wrap mb-16">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Caminho no container</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="volume in volumes" :key="volume.id">
              <td>{{ volume.name }}</td>
              <td class="mono">{{ volume.mountPath }}</td>
              <td>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  style="color: var(--bad)"
                  :disabled="deletingVolumeId === volume.id"
                  @click="deleteVolume(volume.id)"
                >
                  {{ deletingVolumeId === volume.id ? "removendo..." : "Remover" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="app-volume-name">Nome</label>
          <input id="app-volume-name" v-model="newVolumeName" class="form-control" placeholder="uploads" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="app-volume-path">Caminho no container</label>
          <input id="app-volume-path" v-model="newVolumeMountPath" class="form-control mono" placeholder="/app/uploads" />
        </div>
      </div>
      <div class="btn-row">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="addingVolume || !newVolumeName.trim() || !newVolumeMountPath.trim()"
          @click="addVolume"
        >
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ addingVolume ? "adicionando..." : "Adicionar volume" }}
        </button>
      </div>
    </div>
  </div>
</template>
