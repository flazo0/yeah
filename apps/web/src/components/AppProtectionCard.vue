<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{
  basicAuthUser: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  hasDomain: boolean;
  putUrl: string;
}>();
const emit = defineEmits<{ saved: [{ basicAuthUser: string | null; maintenanceMode: boolean; maintenanceMessage: string | null }]; error: [string] }>();

const authEnabled = ref(false);
const user = ref("");
const password = ref("");
const maintenance = ref(false);
const message = ref("");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  authEnabled.value = props.basicAuthUser !== null;
  user.value = props.basicAuthUser ?? "";
  password.value = "";
  maintenance.value = props.maintenanceMode;
  message.value = props.maintenanceMessage ?? "";
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const body: Record<string, unknown> = { maintenance: { enabled: maintenance.value, message: message.value } };
    if (authEnabled.value) body.basicAuth = { user: user.value, ...(password.value ? { password: password.value } : {}) };
    else if (props.basicAuthUser !== null) body.basicAuth = null;
    const res = await api.put<{ application: { basicAuthUser: string | null; maintenanceMode: boolean; maintenanceMessage: string | null } }>(props.putUrl, body);
    emit("saved", { basicAuthUser: res.application.basicAuthUser, maintenanceMode: res.application.maintenanceMode, maintenanceMessage: res.application.maintenanceMessage });
    password.value = "";
    saved.value = true;
    setTimeout(() => (saved.value = false), 2000);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("appProtectionCard.falha"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">lock</span>
    {{ $t("appProtectionCard.titulo") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">{{ $t("appProtectionCard.dica") }}</p>
    <p v-if="!hasDomain" class="hint mb-16">{{ $t("appProtectionCard.precisaDeDominio") }}</p>

    <div class="form-group">
      <label for="app-auth-enabled" style="display: flex; gap: 8px; align-items: center">
        <input id="app-auth-enabled" v-model="authEnabled" type="checkbox" :disabled="!hasDomain" />
        {{ $t("appProtectionCard.pedirSenha") }}
      </label>
    </div>
    <div v-if="authEnabled" class="form-row mb-16">
      <div class="form-group" style="margin-bottom: 0">
        <label for="app-auth-user">{{ $t("appProtectionCard.usuario") }}</label>
        <input id="app-auth-user" v-model="user" class="form-control" autocomplete="off" />
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label for="app-auth-pass">{{ $t("appProtectionCard.senha") }}</label>
        <input id="app-auth-pass" v-model="password" type="password" class="form-control" autocomplete="new-password" :placeholder="basicAuthUser ? $t('appProtectionCard.manterSenha') : ''" />
      </div>
    </div>

    <div class="form-group">
      <label for="app-maint-enabled" style="display: flex; gap: 8px; align-items: center">
        <input id="app-maint-enabled" v-model="maintenance" type="checkbox" :disabled="!hasDomain" />
        {{ $t("appProtectionCard.manutencao") }}
      </label>
    </div>
    <div v-if="maintenance" class="form-group mb-16">
      <label for="app-maint-message">{{ $t("appProtectionCard.mensagem") }}</label>
      <input id="app-maint-message" v-model="message" class="form-control" maxlength="500" :placeholder="$t('appProtectionCard.mensagemPadrao')" />
    </div>

    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving || !hasDomain" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("resourceLimitsCard.salvando") : "Salvar" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("appProtectionCard.salvo") }}</span>
    </div>
  </div>
</template>
