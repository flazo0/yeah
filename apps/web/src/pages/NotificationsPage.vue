<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import type { NotificationChannelDto, NotificationChannelType } from "@yeah/shared";
import { api, ApiError } from "../lib/api";

const route = useRoute();
const teamId = route.params.teamId as string;

const channels = ref<NotificationChannelDto[]>([]);
const loading = ref(true);
const error = ref("");

const form = ref({
  name: "",
  type: "discord" as NotificationChannelType,
  url: "",
  telegramBotToken: "",
  telegramChatId: "",
});
const submitting = ref(false);
const testingId = ref<string | null>(null);
const testResult = ref<Record<string, "ok" | "failed">>({});

const typeLabel: Record<NotificationChannelType, string> = {
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  webhook: "Webhook genérico",
};

const needsUrl = computed(() => form.value.type !== "telegram");
const needsTelegram = computed(() => form.value.type === "telegram");

async function loadChannels() {
  loading.value = true;
  try {
    const res = await api.get<{ channels: NotificationChannelDto[] }>(`/teams/${teamId}/notifications`);
    channels.value = res.channels;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao carregar canais";
  } finally {
    loading.value = false;
  }
}

async function addChannel() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ channel: NotificationChannelDto }>(`/teams/${teamId}/notifications`, {
      name: form.value.name,
      type: form.value.type,
      url: needsUrl.value ? form.value.url : undefined,
      telegramBotToken: needsTelegram.value ? form.value.telegramBotToken : undefined,
      telegramChatId: needsTelegram.value ? form.value.telegramChatId : undefined,
    });
    channels.value.push(res.channel);
    form.value = { name: "", type: "discord", url: "", telegramBotToken: "", telegramChatId: "" };
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar canal";
  } finally {
    submitting.value = false;
  }
}

async function toggleEnabled(channel: NotificationChannelDto) {
  const res = await api.put<{ channel: NotificationChannelDto }>(`/teams/${teamId}/notifications/${channel.id}`, {
    enabled: !channel.enabled,
  });
  const index = channels.value.findIndex((c) => c.id === channel.id);
  if (index !== -1) channels.value[index] = res.channel;
}

async function testChannel(channelId: string) {
  testingId.value = channelId;
  delete testResult.value[channelId];
  try {
    const res = await api.post<{ ok: boolean }>(`/teams/${teamId}/notifications/${channelId}/test`);
    testResult.value = { ...testResult.value, [channelId]: res.ok ? "ok" : "failed" };
  } finally {
    testingId.value = null;
  }
}

async function deleteChannel(channelId: string) {
  await api.delete(`/teams/${teamId}/notifications/${channelId}`);
  channels.value = channels.value.filter((c) => c.id !== channelId);
}

onMounted(loadChannels);
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Notificações</h1>
        <p>Alertas de deploy, backup, servidor e uso de recursos — cada canal recebe todos os tipos por enquanto.</p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">notifications</span>
        Canais do time
      </div>
      <div v-if="loading" class="card-body">
        <div class="empty-state">carregando...</div>
      </div>
      <div v-else-if="channels.length === 0" class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">notifications_off</span>
          Nenhum canal ainda. Sem isso, alertas só aparecem no dashboard.
        </div>
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Ativo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="channel in channels" :key="channel.id">
              <td><strong>{{ channel.name }}</strong></td>
              <td>{{ typeLabel[channel.type] }}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" @click="toggleEnabled(channel)">
                  <span class="badge" :class="channel.enabled ? 'badge-good' : 'badge-neutral'">
                    {{ channel.enabled ? "ativo" : "pausado" }}
                  </span>
                </button>
              </td>
              <td class="btn-row">
                <button type="button" class="btn btn-secondary btn-sm" :disabled="testingId === channel.id" @click="testChannel(channel.id)">
                  <span class="material-symbols-outlined" style="font-size: 16px">send</span>
                  {{ testingId === channel.id ? "enviando..." : "testar" }}
                </button>
                <span v-if="testResult[channel.id] === 'ok'" class="badge badge-good">enviado</span>
                <span v-else-if="testResult[channel.id] === 'failed'" class="badge badge-bad">falhou</span>
                <button type="button" class="btn btn-secondary btn-sm" style="color: var(--bad)" @click="deleteChannel(channel.id)">
                  <span class="material-symbols-outlined" style="font-size: 16px">delete</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Adicionar canal
      </div>
      <div class="card-body">
        <form @submit.prevent="addChannel">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="notif-name">Nome</label>
              <input id="notif-name" v-model="form.name" class="form-control" placeholder="alertas-produção" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="notif-type">Tipo</label>
              <select id="notif-type" v-model="form.type" class="form-control">
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
                <option value="webhook">Webhook genérico</option>
              </select>
            </div>
          </div>
          <div v-if="needsUrl" class="form-group">
            <label for="notif-url">URL do webhook</label>
            <input
              id="notif-url"
              v-model="form.url"
              class="form-control mono"
              :placeholder="form.type === 'discord' ? 'https://discord.com/api/webhooks/...' : form.type === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://...'"
              required
            />
          </div>
          <div v-else class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="notif-bot-token">Bot Token</label>
              <input id="notif-bot-token" v-model="form.telegramBotToken" class="form-control mono" placeholder="123456:ABC-..." required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="notif-chat-id">Chat ID</label>
              <input id="notif-chat-id" v-model="form.telegramChatId" class="form-control mono" placeholder="-100123456789" required />
            </div>
          </div>
          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? "adicionando..." : "Adicionar canal" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
