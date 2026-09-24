<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { WwwRedirect } from "@yeah/shared";
import { api, ApiError } from "../lib/api";

const props = defineProps<{
  domain: string | null;
  extraDomains: string[];
  wwwRedirect: WwwRedirect;
  putUrl: string;
  savedMessage: string;
  /** Domain the server's wildcard would give this app; enables the "Gerar domínio" button. */
  suggestion?: string | null;
}>();
const emit = defineEmits<{ saved: [{ domain: string | null; extraDomains: string[]; wwwRedirect: WwwRedirect }]; error: [string] }>();

const primary = ref("");
const extra = ref("");
const redirect = ref<WwwRedirect>("none");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  primary.value = props.domain ?? "";
  extra.value = props.extraDomains.join("\n");
  redirect.value = props.wwwRedirect;
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const extraDomains = extra.value.split(/[\s,]+/).filter(Boolean);
    const res = await api.put<{ application: { domain: string | null; extraDomains: string[]; wwwRedirect: WwwRedirect } }>(props.putUrl, {
      domain: primary.value,
      extraDomains,
      wwwRedirect: primary.value ? redirect.value : "none",
    });
    emit("saved", { domain: res.application.domain, extraDomains: res.application.extraDomains, wwwRedirect: res.application.wwwRedirect });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
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
    Domínios
  </div>
  <div class="card-body">
    <p class="hint mb-16">
      Deixe em branco pra usar o domínio wildcard do servidor (se o proxy estiver ativo) ou publicar a porta direto no host.
      O certificado HTTPS de cada domínio é emitido sozinho; aponte o DNS pro servidor antes do deploy.
    </p>
    <div class="form-group">
      <label for="app-domain">Domínio principal</label>
      <input id="app-domain" v-model="primary" class="form-control mono" placeholder="minhaapp.exemplo.com" />
      <p v-if="suggestion" class="hint" style="margin-top: 6px">
        O wildcard do servidor sugere <span class="mono">{{ suggestion }}</span>
        <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="primary = suggestion">Gerar domínio</button>
      </p>
    </div>
    <div class="form-group">
      <label for="app-extra-domains">Domínios adicionais</label>
      <textarea id="app-extra-domains" v-model="extra" class="form-control mono" rows="3" placeholder="um por linha (ou separados por vírgula)"></textarea>
      <p class="hint" style="margin-top: 6px">Respondem com o mesmo conteúdo do principal (até 10).</p>
    </div>
    <div class="form-group">
      <label for="app-www">Redirecionamento www</label>
      <select id="app-www" v-model="redirect" class="form-control" :disabled="!primary">
        <option value="none">Sem redirecionamento</option>
        <option value="www_to_root">www.dominio → dominio (sem www)</option>
        <option value="root_to_www">dominio → www.dominio</option>
      </select>
      <p class="hint" style="margin-top: 6px">Redireciona (301) a outra forma do domínio principal pra forma escolhida. Ela também precisa apontar no DNS.</p>
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
