<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import { i18n } from "../../lib/i18n";

interface ImageRow {
  id: string;
  ref: string;
  size: string;
  created: string;
  inUse: boolean;
}

const { server, teamId, error } = useServerContext();
const base = () => `/teams/${teamId}/servers/${server.value!.id}/docker-images`;

const images = ref<ImageRow[]>([]);
const loading = ref(true);
const removing = ref<string | null>(null);

async function load() {
  loading.value = true;
  try {
    images.value = (await api.get<{ images: ImageRow[] }>(base())).images;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverImages.falhaAoCarregar");
  } finally {
    loading.value = false;
  }
}

async function remove(image: ImageRow) {
  // Typing the reference is the confirmation, so a stray click cannot delete an image.
  const typed = prompt(i18n.global.t("serverImages.digitar", { ref: image.ref }));
  if (typed === null) return;
  if (typed.trim() !== image.ref) {
    error.value = i18n.global.t("serverImages.referenciaDiferente");
    return;
  }
  removing.value = image.id;
  error.value = "";
  try {
    await api.post(`${base()}/remove`, { ref: image.ref });
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverImages.falhaAoApagar");
  } finally {
    removing.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">deployed_code</span>
      {{ $t("serverImages.titulo") }}
      <button type="button" class="btn btn-secondary btn-sm" style="margin-left: auto" :disabled="loading" @click="load">{{ $t("serverImages.atualizar") }}</button>
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ $t("serverImages.dica") }}</p>
      <div v-if="!loading && !images.length" class="empty-state">{{ $t("serverImages.nenhuma") }}</div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>{{ $t("serverImages.imagem") }}</th><th>{{ $t("serverImages.tamanho") }}</th><th>{{ $t("serverImages.criada") }}</th><th>{{ $t("serverImages.uso") }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="i in images" :key="i.id + i.ref">
              <td class="mono">{{ i.ref }}</td>
              <td class="mono">{{ i.size }}</td>
              <td>{{ i.created }}</td>
              <td>{{ i.inUse ? $t("serverImages.emUso") : $t("serverImages.semUso") }}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" :disabled="removing === i.id || i.inUse" :title="i.inUse ? $t('serverImages.emUsoDica') : ''" @click="remove(i)">
                  {{ $t("serverImages.apagar") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
