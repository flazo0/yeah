<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { ApplicationDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";

const { app, basePath, error } = useApplicationContext();

const form = ref({
  healthPath: "",
  healthIntervalSeconds: 30,
  healthTimeoutSeconds: 5,
  healthRetries: 3,
  healthStartPeriodSeconds: 30,
  dockerOptions: "",
  stopGraceSeconds: 10,
});
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  if (!app.value) return;
  form.value = {
    healthPath: app.value.healthPath ?? "",
    healthIntervalSeconds: app.value.healthIntervalSeconds,
    healthTimeoutSeconds: app.value.healthTimeoutSeconds,
    healthRetries: app.value.healthRetries,
    healthStartPeriodSeconds: app.value.healthStartPeriodSeconds,
    dockerOptions: app.value.dockerOptions,
    stopGraceSeconds: app.value.stopGraceSeconds,
  };
});

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ application: ApplicationDto }>(`${basePath}/advanced`, {
      ...form.value,
      healthPath: form.value.healthPath.trim() || null,
    });
    app.value = res.application;
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">tune</span>
      Avançado
    </div>
    <div class="card-body">
      <form @submit.prevent="save">
        <h3 class="section-title">Healthcheck</h3>
        <p class="hint mb-16">
          O Docker roda a checagem <em>dentro</em> do container (a imagem precisa ter <span class="mono">curl</span> ou
          <span class="mono">wget</span>). Com um caminho definido, o deploy só termina como sucesso quando o container fica saudável — e
          falha, mostrando as últimas linhas do log, se ele não ficar. Deixe o caminho vazio pra desligar.
        </p>
        <div class="form-group">
          <label for="health-path">Caminho HTTP</label>
          <input id="health-path" v-model="form.healthPath" class="form-control mono" placeholder="/health" />
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-interval">Intervalo (s)</label>
            <input id="health-interval" v-model.number="form.healthIntervalSeconds" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-timeout">Timeout (s)</label>
            <input id="health-timeout" v-model.number="form.healthTimeoutSeconds" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-retries">Tentativas</label>
            <input id="health-retries" v-model.number="form.healthRetries" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-start">Período de início (s)</label>
            <input id="health-start" v-model.number="form.healthStartPeriodSeconds" type="number" min="0" class="form-control" />
          </div>
        </div>

        <h3 class="section-title">Redeploy</h3>
        <div class="form-group">
          <label for="stop-grace">Tolerância de parada (s)</label>
          <input id="stop-grace" v-model.number="form.stopGraceSeconds" type="number" min="0" class="form-control" style="max-width: 200px" />
          <p class="hint" style="margin-top: 6px">
            Quanto tempo o container antigo tem pra encerrar (SIGTERM) antes do SIGKILL, ao redeployar, parar ou reiniciar.
          </p>
        </div>

        <h3 class="section-title">Opções extras do <span class="mono">docker run</span></h3>
        <div class="form-group">
          <textarea
            v-model="form.dockerOptions"
            class="form-control mono"
            rows="3"
            placeholder="--shm-size=1g --cap-add NET_ADMIN --hostname minha-app"
            aria-label="Opções extras do docker run"
          ></textarea>
          <p class="hint" style="margin-top: 6px">
            Cada palavra vira um argumento literal (nada é interpretado pelo shell). <span class="mono">--name</span>,
            <span class="mono">-d</span>, <span class="mono">--rm</span>, <span class="mono">--env-file</span> e
            <span class="mono">--restart</span> são controlados pelo yeah e não podem ser trocados.
          </p>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn" :disabled="saving">
            <span class="material-symbols-outlined" style="font-size: 18px">save</span>
            {{ saving ? "salvando..." : "Salvar" }}
          </button>
          <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">salvo — aplica no próximo deploy</span>
        </div>
      </form>
    </div>
  </div>
</template>
