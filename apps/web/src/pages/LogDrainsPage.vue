<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { LogDrainDto, LogDrainKind } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import PageState from "../components/PageState.vue";

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
});
const submitting = ref(false);
const testingId = ref<string | null>(null);
const testResult = ref<Record<string, "ok" | "failed">>({});

const kindLabel: Record<LogDrainKind, string> = { loki: "Grafana Loki", axiom: "Axiom", new_relic: "New Relic", fluent_bit_http: "Fluent Bit (HTTP input)" };
const needsUrl = computed(() => form.value.kind === "loki" || form.value.kind === "fluent_bit_http");
const needsLokiAuth = computed(() => form.value.kind === "loki");
const needsAxiom = computed(() => form.value.kind === "axiom");
const needsNewRelic = computed(() => form.value.kind === "new_relic");

async function loadDrains() {
  loading.value = true;
  try {
    drains.value = (await api.get<{ drains: LogDrainDto[] }>(`/teams/${teamId}/log-drains`)).drains;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar os destinos";
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
    });
    drains.value.push(res.drain);
    form.value = { name: "", kind: "loki", url: "", lokiUsername: "", lokiPassword: "", axiomDataset: "", axiomToken: "", newRelicLicenseKey: "" };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar o destino";
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
        <h1>Log Drains</h1>
        <p>
          Encaminha o log de cada deploy e execução de tarefa agendada (o log inteiro, no final) pra um agregador externo. Não é um tail contínuo
          da saída dos containers — pra isso, use a aba Logs de cada recurso.
        </p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">receipt_long</span>
        Destinos do time
      </div>
      <div v-if="loading" class="card-body">
        <PageState loading />
      </div>
      <div v-else-if="drains.length === 0" class="card-body">
        <div class="empty-state">Nenhum destino ainda.</div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Tipo</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="drain in drains" :key="drain.id">
              <td>{{ drain.name }}</td>
              <td>{{ kindLabel[drain.kind] }}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" @click="toggleEnabled(drain)">
                  <span class="badge" :class="drain.enabled ? 'badge-good' : 'badge-neutral'">
                    {{ drain.enabled ? "ativo" : "pausado" }}
                  </span>
                </button>
              </td>
              <td>
                <div class="btn-row">
                  <button type="button" class="btn btn-secondary btn-sm" :disabled="testingId === drain.id" @click="testDrain(drain.id)">
                    <span class="material-symbols-outlined" style="font-size: 16px">bolt</span>
                    {{ testingId === drain.id ? "testando..." : "Testar" }}
                  </button>
                  <span v-if="testResult[drain.id] === 'ok'" style="color: var(--good)">enviado</span>
                  <span v-else-if="testResult[drain.id] === 'failed'" style="color: var(--bad)">falhou</span>
                  <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteDrain(drain.id)">
                    <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                    Excluir
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
        Novo destino
      </div>
      <div class="card-body">
        <form @submit.prevent="addDrain">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="ld-name">Nome</label>
              <input id="ld-name" v-model="form.name" class="form-control" placeholder="loki-producao" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="ld-kind">Tipo</label>
              <select id="ld-kind" v-model="form.kind" class="form-control">
                <option value="loki">Grafana Loki</option>
                <option value="axiom">Axiom</option>
                <option value="new_relic">New Relic</option>
                <option value="fluent_bit_http">Fluent Bit (HTTP input)</option>
              </select>
            </div>
          </div>

          <div v-if="needsUrl" class="form-group">
            <label for="ld-url">URL</label>
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
                <label for="ld-loki-user">Usuário (opcional)</label>
                <input id="ld-loki-user" v-model="form.lokiUsername" class="form-control" />
              </div>
              <div class="form-group" style="margin-bottom: 0">
                <label for="ld-loki-pass">Senha (opcional)</label>
                <input id="ld-loki-pass" v-model="form.lokiPassword" type="password" class="form-control" />
              </div>
            </div>
            <p class="hint mb-16">Só preencha se o seu Loki exige autenticação básica (ex.: Grafana Cloud).</p>
          </template>
          <template v-if="needsAxiom">
            <div class="form-group">
              <label for="ld-axiom-dataset">Dataset</label>
              <input id="ld-axiom-dataset" v-model="form.axiomDataset" class="form-control" placeholder="producao" required />
            </div>
            <div class="form-group">
              <label for="ld-axiom-token">API token</label>
              <input id="ld-axiom-token" v-model="form.axiomToken" type="password" class="form-control mono" required />
            </div>
          </template>
          <div v-if="needsNewRelic" class="form-group">
            <label for="ld-nr-key">License key</label>
            <input id="ld-nr-key" v-model="form.newRelicLicenseKey" type="password" class="form-control mono" required />
          </div>

          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? "criando..." : "Adicionar destino" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
