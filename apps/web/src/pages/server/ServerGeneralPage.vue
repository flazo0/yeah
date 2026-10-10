<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { CaCertificateDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";
import { i18n } from "../../lib/i18n";
import { dateLocale } from "../../lib/i18n";

const { server, teamId, error } = useServerContext();
const router = useRouter();
const testing = ref(false);
const sshTimeout = ref(server.value?.sshTimeoutSeconds ?? 15);
const savingTimeout = ref(false);
const timeoutSaved = ref(false);

async function saveTimeout() {
  if (!server.value) return;
  savingTimeout.value = true;
  timeoutSaved.value = false;
  error.value = "";
  try {
    const res = await api.put<{ server: { sshTimeoutSeconds: number } }>(`/teams/${teamId}/servers/${server.value.id}/ssh`, { sshTimeoutSeconds: sshTimeout.value });
    server.value.sshTimeoutSeconds = res.server.sshTimeoutSeconds;
    timeoutSaved.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverGeneral.falhaAoSalvarOTimeout");
  } finally {
    savingTimeout.value = false;
  }
}

const savingMetricsEnabled = ref(false);

async function toggleMetricsEnabled(enabled: boolean) {
  if (!server.value) return;
  savingMetricsEnabled.value = true;
  error.value = "";
  try {
    const res = await api.put<{ server: { metricsEnabled: boolean } }>(`/teams/${teamId}/servers/${server.value.id}/metrics-enabled`, { metricsEnabled: enabled });
    server.value.metricsEnabled = res.server.metricsEnabled;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverGeneral.falhaAoSalvar");
    if (server.value) server.value.metricsEnabled = !enabled;
  } finally {
    savingMetricsEnabled.value = false;
  }
}

const confirmingRemove = ref(false);
const removing = ref(false);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(confirmTimer));

async function removeServer() {
  if (!server.value) return;
  if (!confirmingRemove.value) {
    confirmingRemove.value = true;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingRemove.value = false), 4000);
    return;
  }
  removing.value = true;
  error.value = "";
  try {
    await api.delete(`/teams/${teamId}/servers/${server.value.id}`);
    router.push(`/teams/${teamId}/servers`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverGeneral.falhaAoRemoverOServidor");
    confirmingRemove.value = false;
    removing.value = false;
  }
}

async function testConnection() {
  if (!server.value) return;
  testing.value = true;
  server.value.status = "pending";
  try {
    await api.post(`/teams/${teamId}/servers/${server.value.id}/test-connection`);
  } finally {
    testing.value = false;
  }
}

// ---- CA certificates (registries with a self-signed / private-CA TLS cert)
const certs = ref<CaCertificateDto[]>([]);
const certForm = ref({ name: "", host: "", pem: "" });
const addingCert = ref(false);
const certBasePath = () => `/teams/${teamId}/servers/${server.value!.id}/ca-certificates`;
let certPoll: ReturnType<typeof setInterval> | undefined;

async function loadCerts() {
  if (!server.value) return;
  try {
    certs.value = (await api.get<{ certificates: CaCertificateDto[] }>(certBasePath())).certificates;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverGeneral.falhaAoCarregarOsCertificados");
  }
}

async function addCert() {
  addingCert.value = true;
  error.value = "";
  try {
    const res = await api.post<{ certificate: CaCertificateDto }>(certBasePath(), certForm.value);
    certs.value.push(res.certificate);
    certForm.value = { name: "", host: "", pem: "" };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverGeneral.falhaAoAdicionarOCertificado");
  } finally {
    addingCert.value = false;
  }
}

async function removeCert(cert: CaCertificateDto) {
  try {
    await api.delete(`${certBasePath()}/${cert.id}`);
    cert.status = "queued";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("serverGeneral.falhaAoRemoverOCertificado");
  }
}

onMounted(() => {
  void loadCerts();
  certPoll = setInterval(() => {
    if (certs.value.some((c) => c.status === "queued")) void loadCerts();
  }, 3000);
});
onBeforeUnmount(() => clearInterval(certPoll));
</script>

<template>
  <div v-if="server" class="card">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">info</span>
      {{ $t("serverGeneral.detalhes") }}
    </div>
    <div class="card-body">
      <dl class="kv-list">
        <div><dt>{{ $t("serverGeneral.endereco") }}</dt><dd class="mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</dd></div>
        <div><dt>{{ $t("serverGeneral.status") }}</dt><dd><StatusBadge :status="server.status" /></dd></div>
        <div><dt>{{ $t("serverGeneral.docker") }}</dt><dd class="mono">{{ server.dockerVersion || "-" }}</dd></div>
        <div>
          <dt>{{ $t("serverGeneral.ultimaChecagem") }}</dt>
          <dd>{{ server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString(dateLocale()) : "-" }}</dd>
        </div>
        <div><dt>{{ $t("serverGeneral.proxy") }}</dt><dd><StatusBadge :status="server.proxyStatus" /></dd></div>
      </dl>
      <div class="btn-row" style="margin-top: 16px">
        <button type="button" class="btn btn-secondary" :disabled="testing" @click="testConnection">
          <span class="material-symbols-outlined" style="font-size: 18px">sync</span>
          {{ $t("serverGeneral.testarConexao") }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">timer</span>
      {{ $t("serverGeneral.conexaoSsh") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverGeneral.quantoTempoOPainelEspera") }}
      </p>
      <form class="form-group" @submit.prevent="saveTimeout">
        <label for="ssh-timeout">{{ $t("serverGeneral.timeoutDeConexaoSegundos") }}</label>
        <input id="ssh-timeout" v-model.number="sshTimeout" type="number" min="5" max="120" class="form-control" style="max-width: 160px" />
        <div class="btn-row" style="margin-top: 12px">
          <button type="submit" class="btn btn-secondary" :disabled="savingTimeout">{{ $t("serverGeneral.salvar") }}</button>
          <span v-if="timeoutSaved" class="hint">{{ $t("serverGeneral.salvo") }}</span>
        </div>
      </form>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">monitor_heart</span>
      {{ $t("serverGeneral.monitoramento") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverGeneral.checagemPeriodicaDeCpuRam") }}
      </p>
      <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 0">
        <input id="metrics-enabled" type="checkbox" :checked="server.metricsEnabled" :disabled="savingMetricsEnabled" @change="toggleMetricsEnabled(($event.target as HTMLInputElement).checked)" />
        <label for="metrics-enabled" style="margin: 0">{{ $t("serverGeneral.coletarMetricasDesteServidor") }}</label>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">verified_user</span>
      {{ $t("serverGeneral.certificadosCaRegistries") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverGeneral.seVoceUsaUmRegistry") }} <span class="mono">{{ $t("serverGeneral.hostPorta") }}</span> {{ $t("serverGeneral.semPrecisarDe") }} <span class="mono">{{ $t("serverGeneral.insecureRegistry") }}</span>.
      </p>
      <div v-if="certs.length" class="table-wrap mb-16">
        <table>
          <thead><tr><th>{{ $t("serverGeneral.nome") }}</th><th>{{ $t("serverGeneral.host") }}</th><th>{{ $t("serverGeneral.status") }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="cert in certs" :key="cert.id">
              <td>{{ cert.name }}</td>
              <td class="mono">{{ cert.host }}</td>
              <td>
                <StatusBadge :status="cert.status" kind="job" />
                <span v-if="cert.error" class="hint" style="display: block; color: var(--bad)">{{ cert.error }}</span>
              </td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="removeCert(cert)">
                  <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                  {{ $t("serverGeneral.remover") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form @submit.prevent="addCert">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="ca-name">{{ $t("serverGeneral.nome") }}</label>
            <input id="ca-name" v-model="certForm.name" class="form-control" :placeholder="$t('serverGeneral.registryInterno')" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="ca-host">{{ $t("serverGeneral.hostPorta2") }}</label>
            <input id="ca-host" v-model="certForm.host" class="form-control mono" :placeholder="$t('serverGeneral.registryExampleCom5000')" required />
          </div>
        </div>
        <div class="form-group">
          <label for="ca-pem">{{ $t("serverGeneral.certificadoDaCaPem") }}</label>
          <textarea id="ca-pem" v-model="certForm.pem" class="form-control mono" rows="6" :placeholder="$t('serverGeneral.beginCertificate')" required></textarea>
        </div>
        <button type="submit" class="btn btn-secondary" :disabled="addingCert">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ addingCert ? $t("serverGeneral.adicionando") : $t("serverGeneral.adicionarCertificado") }}
        </button>
      </form>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">warning</span>
      {{ $t("serverGeneral.removerServidor") }}
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        {{ $t("serverGeneral.tiraOServidorDoPainel") }}
      </p>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="removing" @click="removeServer">
        <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
        {{ confirmingRemove ? $t("serverGeneral.confirmarRemocao") : $t("serverGeneral.removerServidor") }}
      </button>
    </div>
  </div>
</template>
