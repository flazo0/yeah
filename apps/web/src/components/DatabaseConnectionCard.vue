<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api, ApiError } from "../lib/api";

const props = defineProps<{ basePath: string; publicAccess: boolean; ssl: boolean }>();
const emit = defineEmits<{ error: [string] }>();

interface Endpoint {
  host: string;
  port: number;
  url: string;
}
interface Connection {
  username: string | null;
  password: string;
  internal: Endpoint;
  external: Endpoint | null;
}

const data = ref<Connection | null>(null);
const reveal = ref(false);
const copied = ref("");

async function load() {
  try {
    data.value = await api.get<Connection>(`${props.basePath}/connection`);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : "falha ao ler a conexão");
  }
}
onMounted(load);
// The endpoints change when public access or TLS is switched.
watch(() => [props.publicAccess, props.ssl], load);

const mask = (url: string, password: string) => (reveal.value ? url : url.split(encodeURIComponent(password)).join("••••••••"));

async function copy(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = key;
    setTimeout(() => (copied.value = ""), 1500);
  } catch {
    copied.value = "";
  }
}
</script>

<template>
  <div v-if="data" class="card-body" style="border-top: 1px solid var(--border)">
    <div class="btn-row" style="justify-content: space-between; margin-bottom: 8px">
      <strong>Conexão</strong>
      <button type="button" class="btn btn-secondary btn-sm" @click="reveal = !reveal">
        <span class="material-symbols-outlined" style="font-size: 16px">{{ reveal ? "visibility_off" : "visibility" }}</span>
        {{ reveal ? "Ocultar senha" : "Mostrar senha" }}
      </button>
    </div>

    <div class="stat-label">Interna — de outros recursos deste ambiente</div>
    <div class="conn-row">
      <code class="callout-code" style="margin: 0; flex: 1">{{ mask(data.internal.url, data.password) }}</code>
      <button type="button" class="btn btn-secondary btn-sm" @click="copy('internal', data.internal.url)">{{ copied === "internal" ? "Copiado" : "Copiar" }}</button>
    </div>

    <div class="stat-label" style="margin-top: 12px">Externa — de fora do servidor</div>
    <div v-if="data.external" class="conn-row">
      <code class="callout-code" style="margin: 0; flex: 1">{{ mask(data.external.url, data.password) }}</code>
      <button type="button" class="btn btn-secondary btn-sm" @click="copy('external', data.external.url)">{{ copied === "external" ? "Copiado" : "Copiar" }}</button>
    </div>
    <p v-else class="hint" style="margin: 0">Acesso externo desligado — o banco só responde dentro da rede do ambiente. Ligue em Configuração → Acesso.</p>
    <p v-if="data.external" class="hint" style="margin-top: 6px">
      A porta <span class="mono">{{ data.external.port }}</span> está aberta na internet, protegida só pela senha{{ ssl ? " (conexão criptografada com certificado autoassinado)" : ". Considere ligar o TLS e restringir por firewall" }}.
    </p>
  </div>
</template>
