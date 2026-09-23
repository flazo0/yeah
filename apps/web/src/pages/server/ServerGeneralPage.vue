<script setup lang="ts">
import { ref } from "vue";
import { api } from "../../lib/api";
import { useServerContext } from "../../composables/useServerContext";
import StatusBadge from "../../components/StatusBadge.vue";

const { server, teamId } = useServerContext();
const testing = ref(false);

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
</template>
