<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, environmentPath, error } = useApplicationContext();
const router = useRouter();

const confirming = ref(false);
const deleting = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(timer));

async function remove() {
  if (!confirming.value) {
    confirming.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (confirming.value = false), 4000);
    return;
  }
  deleting.value = true;
  try {
    await api.delete(basePath);
    router.push(environmentPath);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao excluir aplicação";
    confirming.value = false;
    deleting.value = false;
  }
}
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0; border-color: var(--bad)">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">warning</span>
      Zona de perigo
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Excluir remove o container, os volumes persistentes e os arquivos da aplicação no servidor, e apaga o histórico de deploys.
        Não dá pra desfazer.
      </p>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="deleting" @click="remove">
        <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
        {{ confirming ? "Confirmar exclusão de " + app.name + "?" : "Excluir aplicação" }}
      </button>
    </div>
  </div>
</template>
