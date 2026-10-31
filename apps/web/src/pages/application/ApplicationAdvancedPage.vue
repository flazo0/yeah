<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { ApplicationDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useApplicationContext } from "../../composables/useApplicationContext";
import { i18n } from "../../lib/i18n";

const { app, basePath, error } = useApplicationContext();

const form = ref({
  healthPath: "",
  healthIntervalSeconds: 30,
  healthTimeoutSeconds: 5,
  healthRetries: 3,
  healthStartPeriodSeconds: 30,
  dockerOptions: "",
  stopGraceSeconds: 10,
  rollbackImages: 0,
  redactEnvInLogs: false,
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
    rollbackImages: app.value.rollbackImages,
    redactEnvInLogs: app.value.redactEnvInLogs,
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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("applicationAdvanced.failedToSave");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="app" class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">tune</span>
      {{ $t("applicationAdvanced.advanced") }}
    </div>
    <div class="card-body">
      <form @submit.prevent="save">
        <h3 class="section-title">{{ $t("applicationAdvanced.healthcheck") }}</h3>
        <p class="hint mb-16">
          {{ $t("applicationAdvanced.dockerRunsCheck") }} <em>{{ $t("applicationAdvanced.inside") }}</em> {{ $t("applicationAdvanced.theContainerImageMustHave") }} <span class="mono">{{ $t("applicationAdvanced.curl") }}</span> {{ $t("applicationAdvanced.or") }}
          <span class="mono">{{ $t("applicationAdvanced.wget") }}</span>{{ $t("applicationAdvanced.withPathSetDeployOnly") }}
        </p>
        <div class="form-group">
          <label for="health-path">{{ $t("applicationAdvanced.httpPath") }}</label>
          <input id="health-path" v-model="form.healthPath" class="form-control mono" placeholder="/health" />
        </div>
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-interval">{{ $t("applicationAdvanced.intervalS") }}</label>
            <input id="health-interval" v-model.number="form.healthIntervalSeconds" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-timeout">{{ $t("applicationAdvanced.timeoutS") }}</label>
            <input id="health-timeout" v-model.number="form.healthTimeoutSeconds" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-retries">{{ $t("applicationAdvanced.retries") }}</label>
            <input id="health-retries" v-model.number="form.healthRetries" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="health-start">{{ $t("applicationAdvanced.startPeriodS") }}</label>
            <input id="health-start" v-model.number="form.healthStartPeriodSeconds" type="number" min="0" class="form-control" />
          </div>
        </div>

        <h3 class="section-title">{{ $t("applicationAdvanced.redeploy") }}</h3>
        <div class="form-group">
          <label for="stop-grace">{{ $t("applicationAdvanced.stopGracePeriodS") }}</label>
          <input id="stop-grace" v-model.number="form.stopGraceSeconds" type="number" min="0" class="form-control" style="max-width: 200px" />
          <p class="hint" style="margin-top: 6px">
            {{ $t("applicationAdvanced.howLongOldContainerHas") }}
          </p>
        </div>

        <div class="form-group">
          <label for="rollback-images">{{ $t("applicationAdvanced.rollbackImagesToKeep") }}</label>
          <input id="rollback-images" v-model.number="form.rollbackImages" type="number" min="0" max="20" class="form-control" style="max-width: 200px" />
          <p class="hint" style="margin-top: 6px">{{ $t("applicationAdvanced.rollbackImagesHint") }}</p>
        </div>

        <h3 class="section-title">{{ $t("applicationAdvanced.logsTitle") }}</h3>
        <div class="form-group">
          <label for="redact-env" style="display: flex; gap: 8px; align-items: center">
            <input id="redact-env" v-model="form.redactEnvInLogs" type="checkbox" />
            {{ $t("applicationAdvanced.hideEnvironmentVariableValuesDeploy") }}
          </label>
          <p class="hint" style="margin-top: 6px">{{ $t("applicationAdvanced.appliesNextDeployValues6") }}</p>
        </div>

        <h3 class="section-title">{{ $t("applicationAdvanced.extraOptionsFor") }} <span class="mono">{{ $t("applicationAdvanced.dockerRun") }}</span></h3>
        <div class="form-group">
          <textarea
            v-model="form.dockerOptions"
            class="form-control mono"
            rows="3"
            placeholder="--shm-size=1g --cap-add NET_ADMIN --hostname my-app"
            :aria-label="$t('applicationAdvanced.extraOptionsDockerRun')"
          ></textarea>
          <p class="hint" style="margin-top: 6px">
            {{ $t("applicationAdvanced.eachWordBecomesLiteralArgument") }} <span class="mono">{{ $t("applicationAdvanced.name") }}</span>,
            <span class="mono">{{ $t("applicationAdvanced.d") }}</span>, <span class="mono">{{ $t("applicationAdvanced.rm") }}</span>, <span class="mono">{{ $t("applicationAdvanced.envFile") }}</span> {{ $t("applicationAdvanced.and") }}
            <span class="mono">{{ $t("applicationAdvanced.restart") }}</span> {{ $t("applicationAdvanced.areControlledYeahCannotChanged") }}
          </p>
        </div>

        <div class="btn-row">
          <button type="submit" class="btn" :disabled="saving">
            <span class="material-symbols-outlined" style="font-size: 18px">save</span>
            {{ saving ? $t("applicationAdvanced.saving") : $t("common.save") }}
          </button>
          <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("applicationAdvanced.savedAppliesNextDeploy") }}</span>
        </div>
      </form>
    </div>
  </div>
</template>
