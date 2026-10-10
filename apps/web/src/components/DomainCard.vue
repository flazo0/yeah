<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{
  domain: string | null;
  putUrl: string;
  savedMessage: string;
  /** Domain the server's wildcard would give this resource; enables the "Gerar domínio" button. */
  suggestion?: string | null;
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
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("domainCard.falhaAoSalvarDominio"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
    {{ $t("domainCard.dominio") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">
      {{ $t("domainCard.deixeEmBrancoPraUsar") }}
    </p>
    <div class="form-group">
      <label for="resource-domain">{{ $t("domainCard.dominioCustomizado") }}</label>
      <input id="resource-domain" v-model="form" class="form-control mono" :placeholder="$t('domainCard.minhaappExemploCom')" />
      <p v-if="suggestion" class="hint" style="margin-top: 6px">
        {{ $t("domainCard.oWildcardDoServidorSugere") }} <span class="mono">{{ suggestion }}</span>
        <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="form = suggestion">{{ $t("domainCard.gerarDominio") }}</button>
      </p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("domainCard.salvando") : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ savedMessage }}</span>
    </div>
  </div>
</template>
