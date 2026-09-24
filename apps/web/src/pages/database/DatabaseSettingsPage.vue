<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { DATABASE_ENGINES } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useDatabaseContext } from "../../composables/useDatabaseContext";

const { database, basePath, error, reloadDatabase } = useDatabaseContext();

const info = computed(() => (database.value ? DATABASE_ENGINES[database.value.engine] : null));
const form = ref({ image: "", publicAccess: false, port: 5432, ssl: false, healthEnabled: true, healthIntervalSeconds: 30, healthTimeoutSeconds: 10, healthRetries: 5 });
const saving = ref(false);
const saved = ref(false);
const imageChanged = computed(() => Boolean(database.value && form.value.image !== database.value.image));

watchEffect(() => {
  const d = database.value;
  if (!d) return;
  form.value = {
    image: d.image,
    publicAccess: d.publicAccess,
    port: d.port,
    ssl: d.ssl,
    healthEnabled: d.healthEnabled,
    healthIntervalSeconds: d.healthIntervalSeconds,
    healthTimeoutSeconds: d.healthTimeoutSeconds,
    healthRetries: d.healthRetries,
  };
});

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    await api.put(`${basePath}/settings`, form.value);
    await reloadDatabase();
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form v-if="database && info" @submit.prevent="save">
    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">new_releases</span> Versão</div>
      <div class="card-body">
        <div class="form-group">
          <label for="db-image">Imagem</label>
          <input id="db-image" v-model="form.image" class="form-control mono" list="db-versions" />
          <datalist id="db-versions">
            <option v-for="v in info.versions" :key="v" :value="`${info.imageRepo}:${v}`" />
          </datalist>
        </div>
        <p class="hint">
          Trocar a imagem recria o container mantendo os dados. Subir de <strong>versão maior</strong> (ex.: PostgreSQL 15 → 16) costuma exigir migração dos dados:
          faça um backup antes.
        </p>
        <p v-if="imageChanged" class="callout" style="margin-top: 8px">Você mudou a imagem — ao salvar o banco reinicia com a nova versão.</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">public</span> Acesso</div>
      <div class="card-body">
        <label class="check-row">
          <input v-model="form.publicAccess" type="checkbox" />
          <span>Acesso externo (publicar a porta no servidor)</span>
        </label>
        <p class="hint" style="margin: 4px 0 12px">
          Desligado (padrão), só recursos do mesmo ambiente conectam, pelo nome interno <span class="mono">{{ database.internalHost }}</span>.
          Ligado, qualquer um que alcance o servidor pode tentar a senha.
        </p>
        <div v-if="form.publicAccess" class="form-group">
          <label for="db-port">Porta no servidor</label>
          <input id="db-port" v-model.number="form.port" type="number" min="1" max="65535" class="form-control" style="max-width: 160px" />
        </div>
        <label v-if="info.supportsSsl" class="check-row">
          <input v-model="form.ssl" type="checkbox" />
          <span>Exigir TLS (certificado autoassinado gerado pelo painel)</span>
        </label>
        <p v-if="info.supportsSsl" class="hint" style="margin: 4px 0 0">
          A conexão passa a ser criptografada e sem TLS é recusada. O certificado não é validado por uma autoridade: use o modo "require" do cliente (a URL de conexão já vem assim).
        </p>
        <p v-else class="hint" style="margin: 0">{{ info.label }} ainda não tem TLS pelo painel.</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">monitor_heart</span> Healthcheck</div>
      <div class="card-body">
        <label class="check-row">
          <input v-model="form.healthEnabled" type="checkbox" />
          <span>Verificar a saúde do banco</span>
        </label>
        <p class="hint" style="margin: 4px 0 12px">O Docker pergunta ao próprio banco se ele responde; o provisionamento só termina como "rodando" quando ele responde.</p>
        <div v-if="form.healthEnabled" class="form-row">
          <div class="form-group" style="margin-bottom: 0">
            <label for="hc-interval">Intervalo (s)</label>
            <input id="hc-interval" v-model.number="form.healthIntervalSeconds" type="number" min="5" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="hc-timeout">Timeout (s)</label>
            <input id="hc-timeout" v-model.number="form.healthTimeoutSeconds" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="hc-retries">Tentativas</label>
            <input id="hc-retries" v-model.number="form.healthRetries" type="number" min="1" class="form-control" />
          </div>
        </div>
        <p v-if="info.label === 'Dragonfly'" class="hint" style="margin-top: 8px">A imagem do Dragonfly não traz um cliente pra perguntar — sem healthcheck nesse motor.</p>
      </div>
    </div>

    <div class="btn-row">
      <button type="submit" class="btn" :disabled="saving">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? "salvando..." : "Salvar e recriar o container" }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">salvo — recriando</span>
    </div>
  </form>
</template>
