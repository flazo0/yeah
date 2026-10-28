<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { LogDrainDto, LogDrainKind } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";
import { i18n } from "../lib/i18n";

const route = useRoute();
const teamId = route.params.teamId as string;

const drains = ref<LogDrainDto[]>([]);
const loading = ref(true);
const error = ref("");

const form = ref({
  name: "",
  kind: "loki" as LogDrainKind,
  url: "",
  lokiUsername: "",
  lokiPassword: "",
  axiomDataset: "",
  axiomToken: "",
  newRelicLicenseKey: "",
  awsRegion: "us-east-1",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsLogGroup: "yeah",
  awsLogStream: "deploys",
});
const submitting = ref(false);
const testingId = ref<string | null>(null);
const testResult = ref<Record<string, "ok" | "failed">>({});

const kindLabel: Record<LogDrainKind, string> = { loki: "Grafana Loki", axiom: "Axiom", new_relic: "New Relic", fluent_bit_http: "Fluent Bit (HTTP input)", cloudwatch: "AWS CloudWatch Logs" };
const needsUrl = computed(() => form.value.kind === "loki" || form.value.kind === "fluent_bit_http");
const needsLokiAuth = computed(() => form.value.kind === "loki");
const needsAxiom = computed(() => form.value.kind === "axiom");
const needsNewRelic = computed(() => form.value.kind === "new_relic");
const needsCloudWatch = computed(() => form.value.kind === "cloudwatch");

async function loadDrains() {
  loading.value = true;
  try {
    drains.value = (await api.get<{ drains: LogDrainDto[] }>(`/teams/${teamId}/log-drains`)).drains;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("logDrains.falhaAoCarregarOsDestinos");
  } finally {
    loading.value = false;
  }
}

async function addDrain() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ drain: LogDrainDto }>(`/teams/${teamId}/log-drains`, {
      name: form.value.name,
      kind: form.value.kind,
      url: needsUrl.value ? form.value.url : undefined,
      lokiUsername: needsLokiAuth.value && form.value.lokiUsername ? form.value.lokiUsername : undefined,
      lokiPassword: needsLokiAuth.value && form.value.lokiPassword ? form.value.lokiPassword : undefined,
      axiomDataset: needsAxiom.value ? form.value.axiomDataset : undefined,
      axiomToken: needsAxiom.value ? form.value.axiomToken : undefined,
      newRelicLicenseKey: needsNewRelic.value ? form.value.newRelicLicenseKey : undefined,
      awsRegion: needsCloudWatch.value ? form.value.awsRegion : undefined,
      awsAccessKeyId: needsCloudWatch.value ? form.value.awsAccessKeyId : undefined,
      awsSecretAccessKey: needsCloudWatch.value ? form.value.awsSecretAccessKey : undefined,
      awsLogGroup: needsCloudWatch.value ? form.value.awsLogGroup : undefined,
      awsLogStream: needsCloudWatch.value ? form.value.awsLogStream : undefined,
    });
    drains.value.push(res.drain);
    form.value = { name: "", kind: "loki", url: "", lokiUsername: "", lokiPassword: "", axiomDataset: "", axiomToken: "", newRelicLicenseKey: "", awsRegion: "us-east-1", awsAccessKeyId: "", awsSecretAccessKey: "", awsLogGroup: "yeah", awsLogStream: "deploys" };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("logDrains.falhaAoCriarODestino");
  } finally {
    submitting.value = false;
  }
}

async function toggleEnabled(drain: LogDrainDto) {
  const res = await api.put<{ drain: LogDrainDto }>(`/teams/${teamId}/log-drains/${drain.id}`, { enabled: !drain.enabled });
  const index = drains.value.findIndex((d) => d.id === drain.id);
  if (index !== -1) drains.value[index] = res.drain;
}

async function testDrain(drainId: string) {
  testingId.value = drainId;
  delete testResult.value[drainId];
  try {
    const res = await api.post<{ ok: boolean }>(`/teams/${teamId}/log-drains/${drainId}/test`);
    testResult.value = { ...testResult.value, [drainId]: res.ok ? "ok" : "failed" };
  } finally {
    testingId.value = null;
  }
}

async function deleteDrain(drainId: string) {
  await api.delete(`/teams/${teamId}/log-drains/${drainId}`);
  drains.value = drains.value.filter((d) => d.id !== drainId);
}

onMounted(loadDrains);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("logDrains.logDrains") }}</h1>
        <p>
          {{ $t("logDrains.encaminhaOLogDeCada") }}
        </p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">receipt_long</span>
        {{ $t("logDrains.destinosDoTime") }}
      </div>
      <div v-if="loading" class="card-body">
        <PageState loading />
      </div>
      <div v-else-if="drains.length === 0" class="card-body">
        <div class="empty-state">{{ $t("logDrains.nenhumDestinoAinda") }}</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>{{ $t("logDrains.nome") }}</th><th>{{ $t("logDrains.tipo") }}</th><th>{{ $t("logDrains.status") }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="drain in drains" :key="drain.id">
              <td>{{ drain.name }}</td>
              <td>{{ kindLabel[drain.kind] }}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" @click="toggleEnabled(drain)">
                  <span class="badge" :class="drain.enabled ? 'badge-good' : 'badge-neutral'">
                    {{ drain.enabled ? $t('common.active') : $t('common.paused') }}
                  </span>
                </button>
              </td>
              <td>
                <div class="btn-row">
                  <button type="button" class="btn btn-secondary btn-sm" :disabled="testingId === drain.id" @click="testDrain(drain.id)">
                    <span class="material-symbols-outlined" style="font-size: 16px">bolt</span>
                    {{ testingId === drain.id ? $t("logDrains.testando") : "Testar" }}
                  </button>
                  <span v-if="testResult[drain.id] === 'ok'" style="color: var(--good)">{{ $t("logDrains.enviado") }}</span>
                  <span v-else-if="testResult[drain.id] === 'failed'" style="color: var(--bad)">{{ $t("logDrains.falhou") }}</span>
                  <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteDrain(drain.id)">
                    <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                    {{ $t("logDrains.excluir") }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        {{ $t("logDrains.novoDestino") }}
      </div>
      <div class="card-body">
        <form @submit.prevent="addDrain">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="ld-name">{{ $t("logDrains.nome") }}</label>
              <input id="ld-name" v-model="form.name" class="form-control" :placeholder="$t('logDrains.lokiProducao')" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="ld-kind">{{ $t("logDrains.tipo") }}</label>
              <select id="ld-kind" v-model="form.kind" class="form-control">
                <option value="loki">{{ $t("logDrains.grafanaLoki") }}</option>
                <option value="axiom">{{ $t("logDrains.axiom") }}</option>
                <option value="new_relic">{{ $t("logDrains.newRelic") }}</option>
                <option value="fluent_bit_http">{{ $t("logDrains.fluentBitHttpInput") }}</option>
                <option value="cloudwatch">{{ $t("logDrains.cloudwatch") }}</option>
              </select>
            </div>
          </div>

          <div v-if="needsUrl" class="form-group">
            <label for="ld-url">{{ $t("logDrains.url") }}</label>
            <input
              id="ld-url"
              v-model="form.url"
              class="form-control mono"
              :placeholder="form.kind === 'loki' ? 'https://loki.exemplo.com' : 'http://coletor:9880/logs'"
              required
            />
          </div>
          <template v-if="needsLokiAuth">
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-loki-user">{{ $t("logDrains.usuarioOpcional") }}</label>
                <input id="ld-loki-user" v-model="form.lokiUsername" class="form-control" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-loki-pass">{{ $t("logDrains.senhaOpcional") }}</label>
                <input id="ld-loki-pass" v-model="form.lokiPassword" type="password" class="form-control" />
              </div>
            </div>
            <p class="hint mb-16">{{ $t("logDrains.soPreenchaSeOSeu") }}</p>
          </template>
          <template v-if="needsAxiom">
            <div class="form-group">
              <label for="ld-axiom-dataset">{{ $t("logDrains.dataset") }}</label>
              <input id="ld-axiom-dataset" v-model="form.axiomDataset" class="form-control" :placeholder="$t('logDrains.producao')" required />
            </div>
            <div class="form-group">
              <label for="ld-axiom-token">{{ $t("logDrains.apiToken") }}</label>
              <input id="ld-axiom-token" v-model="form.axiomToken" type="password" class="form-control mono" required />
            </div>
          </template>
          <template v-if="needsCloudWatch">
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-aws-region">{{ $t("logDrains.awsRegiao") }}</label>
                <input id="ld-aws-region" v-model="form.awsRegion" class="form-control mono" placeholder="us-east-1" required />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-aws-group">{{ $t("logDrains.awsGrupo") }}</label>
                <input id="ld-aws-group" v-model="form.awsLogGroup" class="form-control mono" required />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-aws-stream">{{ $t("logDrains.awsStream") }}</label>
                <input id="ld-aws-stream" v-model="form.awsLogStream" class="form-control mono" required />
              </div>
            </div>
            <div class="form-row mb-16">
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-aws-key">{{ $t("logDrains.awsChave") }}</label>
                <input id="ld-aws-key" v-model="form.awsAccessKeyId" class="form-control mono" autocomplete="off" required />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-aws-secret">{{ $t("logDrains.awsSegredo") }}</label>
                <input id="ld-aws-secret" v-model="form.awsSecretAccessKey" type="password" class="form-control mono" autocomplete="new-password" required />
              </div>
            </div>
            <p class="hint mb-16">{{ $t("logDrains.awsDica") }}</p>
          </template>
          <div v-if="needsNewRelic" class="form-group">
            <label for="ld-nr-key">{{ $t("logDrains.licenseKey") }}</label>
            <input id="ld-nr-key" v-model="form.newRelicLicenseKey" type="password" class="form-control mono" required />
          </div>

          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? $t("logDrains.criando") : $t("logDrains.adicionarDestino") }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
