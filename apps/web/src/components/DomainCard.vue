<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";

const props = defineProps<{
  domain: string | null;
  putUrl: string;
  savedMessage: string;
}>();

const emit = defineEmits<{
  saved: [string | null];
  error: [string];
}>();

const form = ref("");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  form.value = props.domain ?? "";
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    await api.put(props.putUrl, { domain: form.value });
    emit("saved", form.value || null);
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : "falha ao salvar domínio");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
    Domínio
  </div>
  <div class="card-body">
    <p class="hint mb-16">
      Deixe em branco pra usar o domínio wildcard do servidor (se o proxy estiver ativo) ou publicar a porta direto no host.
    </p>
    <div class="form-group">
      <label for="resource-domain">Domínio customizado</label>
      <input id="resource-domain" v-model="form" class="form-control mono" placeholder="minhaapp.exemplo.com" />
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? "salvando..." : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ savedMessage }}</span>
    </div>
  </div>
</template>
