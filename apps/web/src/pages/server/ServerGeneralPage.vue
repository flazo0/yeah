<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { CaCertificateDto } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";

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
    error.value = err instanceof ApiError ? err.message : "falha ao salvar o timeout";
  } finally {
    savingTimeout.value = false;
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
    error.value = err instanceof ApiError ? err.message : "falha ao remover o servidor";
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
    error.value = err instanceof ApiError ? err.message : "falha ao carregar os certificados";
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
    error.value = err instanceof ApiError ? err.message : "falha ao adicionar o certificado";
  } finally {
    addingCert.value = false;
  }
}

async function removeCert(cert: CaCertificateDto) {
  try {
    await api.delete(`${certBasePath()}/${cert.id}`);
    cert.status = "queued";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao remover o certificado";
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
      Detalhes
    </div>
    <div class="card-body">
      <dl class="kv-list">
        <div><dt>Endereço</dt><dd class="mono">{{ server.sshUser }}@{{ server.host }}:{{ server.port }}</dd></div>
        <div><dt>Status</dt><dd><StatusBadge :status="server.status" /></dd></div>
        <div><dt>Docker</dt><dd class="mono">{{ server.dockerVersion || "-" }}</dd></div>
        <div>
          <dt>Última checagem</dt>
          <dd>{{ server.lastCheckedAt ? new Date(server.lastCheckedAt).toLocaleString("pt-BR") : "-" }}</dd>
        </div>
        <div><dt>Proxy</dt><dd><StatusBadge :status="server.proxyStatus" /></dd></div>
      </dl>
      <div class="btn-row" style="margin-top: 16px">
        <button type="button" class="btn btn-secondary" :disabled="testing" @click="testConnection">
          <span class="material-symbols-outlined" style="font-size: 18px">sync</span>
          Testar conexão
        </button>
      </div>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">timer</span>
      Conexão SSH
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Quanto tempo o painel espera o servidor responder ao conectar antes de desistir. Aumente pra máquinas lentas ou muito distantes.
      </p>
      <form class="form-group" @submit.prevent="saveTimeout">
        <label for="ssh-timeout">Timeout de conexão (segundos)</label>
        <input id="ssh-timeout" v-model.number="sshTimeout" type="number" min="5" max="120" class="form-control" style="max-width: 160px" />
        <div class="btn-row" style="margin-top: 12px">
          <button type="submit" class="btn btn-secondary" :disabled="savingTimeout">Salvar</button>
          <span v-if="timeoutSaved" class="hint">Salvo.</span>
        </div>
      </form>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px">verified_user</span>
      Certificados CA (registries)
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Se você usa um registry Docker próprio com certificado autoassinado (ou de uma CA interna), cadastre a CA aqui — o Docker deste
        servidor passa a confiar em <span class="mono">host[:porta]</span> sem precisar de <span class="mono">--insecure-registry</span>.
      </p>
      <div v-if="certs.length" class="table-wrap mb-16">
        <table>
          <thead><tr><th>Nome</th><th>Host</th><th>Status</th><th></th></tr></thead>
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
                  Remover
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form @submit.prevent="addCert">
        <div class="form-row mb-16">
          <div class="form-group" style="margin-bottom: 0">
            <label for="ca-name">Nome</label>
            <input id="ca-name" v-model="certForm.name" class="form-control" placeholder="registry-interno" required />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label for="ca-host">Host[:porta]</label>
            <input id="ca-host" v-model="certForm.host" class="form-control mono" placeholder="registry.example.com:5000" required />
          </div>
        </div>
        <div class="form-group">
          <label for="ca-pem">Certificado da CA (PEM)</label>
          <textarea id="ca-pem" v-model="certForm.pem" class="form-control mono" rows="6" placeholder="-----BEGIN CERTIFICATE-----" required></textarea>
        </div>
        <button type="submit" class="btn btn-secondary" :disabled="addingCert">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          {{ addingCert ? "adicionando..." : "Adicionar certificado" }}
        </button>
      </form>
    </div>
  </div>

  <div v-if="server" class="card" style="margin-top: 16px">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 18px; color: var(--bad)">warning</span>
      Remover servidor
    </div>
    <div class="card-body">
      <p class="hint mb-16">
        Tira o servidor do painel; nada é apagado na máquina (containers, proxy e arquivos ficam lá). Só dá pra remover quando
        não houver aplicação, banco ou serviço nele.
      </p>
      <button type="button" class="btn btn-secondary" style="color: var(--bad)" :disabled="removing" @click="removeServer">
        <span class="material-symbols-outlined" style="font-size: 18px">delete</span>
        {{ confirmingRemove ? "Confirmar remoção?" : "Remover servidor" }}
      </button>
    </div>
  </div>
</template>
