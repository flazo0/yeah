<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ApplicationDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

// One-click connection of a file-based database (SQLite) to an application: the API mounts the database's
// volume in the application and sets a variable to the file's URL; it applies on the application's next deploy.
const props = defineProps<{ basePath: string; environmentPath: string; serverId: string }>();
const emit = defineEmits<{ error: [string] }>();

const apps = ref<ApplicationDto[]>([]);
const applicationId = ref("");
const envKey = ref("DATABASE_URL");
const mountPath = ref("/data");
const busy = ref(false);
const done = ref<{ envKey: string; url: string; mountPath: string } | null>(null);

// Only applications on the database's server can share its volume; Compose applications manage their own volumes.
const candidates = computed(() => apps.value.filter((a) => a.serverId === props.serverId && a.buildPack !== "docker_compose"));

onMounted(async () => {
  try {
    apps.value = (await api.get<{ applications: ApplicationDto[] }>(`${props.environmentPath}/applications`)).applications;
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("databaseConnectApplication.failedLoadApplications"));
  }
});

async function connect() {
  if (!applicationId.value) return;
  busy.value = true;
  done.value = null;
  try {
    const res = await api.post<{ envKey: string; url: string; mountPath: string }>(`${props.basePath}/connect-application`, {
      applicationId: applicationId.value,
      envKey: envKey.value.trim() || undefined,
      mountPath: mountPath.value.trim() || undefined,
    });
    done.value = res;
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("databaseConnectApplication.failedConnect"));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="card-body" style="border-top: 1px solid var(--border)">
    <strong>{{ $t("databaseConnectApplication.title") }}</strong>
    <p class="hint" style="margin: 4px 0 12px">{{ $t("databaseConnectApplication.hint") }}</p>
    <p v-if="candidates.length === 0" class="hint" style="margin: 0">{{ $t("databaseConnectApplication.noApplications") }}</p>
    <template v-else>
      <div class="form-row mb-16">
        <div class="form-group" style="margin-bottom: 0">
          <label for="sqlite-app">{{ $t("databaseConnectApplication.application") }}</label>
          <select id="sqlite-app" v-model="applicationId" class="form-control">
            <option value="" disabled>{{ $t("databaseConnectApplication.choose") }}</option>
            <option v-for="a in candidates" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="sqlite-key">{{ $t("databaseConnectApplication.variable") }}</label>
          <input id="sqlite-key" v-model="envKey" class="form-control mono" />
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label for="sqlite-mount">{{ $t("databaseConnectApplication.mountPath") }}</label>
          <input id="sqlite-mount" v-model="mountPath" class="form-control mono" />
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" :disabled="busy || !applicationId" @click="connect">
          {{ busy ? $t("databaseConnectApplication.connecting") : $t("databaseConnectApplication.connect") }}
        </button>
      </div>
      <p v-if="done" class="callout" style="margin-top: 12px">
        {{ $t("databaseConnectApplication.done", { key: done.envKey, url: done.url, path: done.mountPath }) }}
      </p>
    </template>
  </div>
</template>
