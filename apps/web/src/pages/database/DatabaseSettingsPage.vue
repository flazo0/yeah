<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { DATABASE_ENGINES } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useDatabaseContext } from "../../composables/useDatabaseContext";
import { i18n } from "../../lib/i18n";

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
    error.value = err instanceof ApiError ? err.message : i18n.global.t("databaseSettings.failedToSave");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form v-if="database && info" @submit.prevent="save">
    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">new_releases</span> {{ $t("databaseSettings.version") }}</div>
      <div class="card-body">
        <div class="form-group">
          <label for="db-image">{{ $t("databaseSettings.image") }}</label>
          <input id="db-image" v-model="form.image" class="form-control mono" list="db-versions" />
          <datalist id="db-versions">
            <option v-for="v in info.versions" :key="v" :value="`${info.imageRepo}:${v}`" />
          </datalist>
        </div>
        <p class="hint">
          {{ $t("databaseSettings.changingImageRecreatesContainerKeeping") }} <strong>{{ $t("databaseSettings.majorVersion") }}</strong> {{ $t("databaseSettings.eGPostgresql1516") }}
        </p>
        <p v-if="imageChanged" class="callout" style="margin-top: 8px">{{ $t("databaseSettings.youChangedImageSaveDatabase") }}</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">public</span> {{ $t("databaseSettings.access") }}</div>
      <div class="card-body">
        <label class="check-row">
          <input v-model="form.publicAccess" type="checkbox" />
          <span>{{ $t("databaseSettings.externalAccessPublishPortServer") }}</span>
        </label>
        <p class="hint" style="margin: 4px 0 12px">
          {{ $t("databaseSettings.offDefaultOnlyResourcesSame") }} <span class="mono">{{ database.internalHost }}</span>{{ $t("databaseSettings.onAnyoneWhoCanReach") }}
        </p>
        <div v-if="form.publicAccess" class="form-group">
          <label for="db-port">{{ $t("databaseSettings.portServer") }}</label>
          <input id="db-port" v-model.number="form.port" type="number" min="1" max="65535" class="form-control" style="max-width: 160px" />
        </div>
        <label v-if="info.supportsSsl" class="check-row">
          <input v-model="form.ssl" type="checkbox" />
          <span>{{ $t("databaseSettings.requireTlsSelfSignedCertificate") }}</span>
        </label>
        <p v-if="info.supportsSsl" class="hint" style="margin: 4px 0 0">
          {{ $t("databaseSettings.theConnectionBecomesEncryptedConnecting") }}
        </p>
        <p v-else class="hint" style="margin: 0">{{ $t("databaseSettings.doesnTHaveTlsThrough", { p0: info.label }) }}</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">monitor_heart</span> {{ $t("databaseSettings.healthcheck") }}</div>
      <div class="card-body">
        <label class="check-row">
          <input v-model="form.healthEnabled" type="checkbox" />
          <span>{{ $t("databaseSettings.checkDatabaseSHealth") }}</span>
        </label>
        <p class="hint" style="margin: 4px 0 12px">{{ $t("databaseSettings.dockerAsksDatabaseItselfWhether") }}</p>
        <div v-if="form.healthEnabled" class="form-row">
          <div class="form-group" style="margin-bottom: 0">
            <label for="hc-interval">{{ $t("databaseSettings.intervalS") }}</label>
            <input id="hc-interval" v-model.number="form.healthIntervalSeconds" type="number" min="5" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="hc-timeout">{{ $t("databaseSettings.timeoutS") }}</label>
            <input id="hc-timeout" v-model.number="form.healthTimeoutSeconds" type="number" min="1" class="form-control" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="hc-retries">{{ $t("databaseSettings.retries") }}</label>
            <input id="hc-retries" v-model.number="form.healthRetries" type="number" min="1" class="form-control" />
          </div>
        </div>
        <p v-if="info.label === 'Dragonfly'" class="hint" style="margin-top: 8px">{{ $t("databaseSettings.theDragonflyImageDoesnT") }}</p>
      </div>
    </div>

    <div class="btn-row">
      <button type="submit" class="btn" :disabled="saving">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("databaseSettings.saving") : $t("databaseSettings.saveRecreateContainer") }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("databaseSettings.savedRecreating") }}</span>
    </div>
  </form>
</template>
