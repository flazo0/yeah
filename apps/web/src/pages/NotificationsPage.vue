<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { NOTIFICATION_EVENT_LABELS, type NotificationChannelDto, type NotificationChannelType, type NotificationEventType } from "@yeah/shared";
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
  events: [] as NotificationEventType[],
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

const EVENT_TYPES = Object.keys(NOTIFICATION_EVENT_LABELS) as NotificationEventType[];
const editingEventsId = ref<string | null>(null);
const editingEvents = ref<NotificationEventType[]>([]);
const savingEvents = ref(false);

function eventsSummary(events: NotificationEventType[] | null): string {
  if (!events || events.length === 0) return "todos os eventos";
  return events.map((e) => NOTIFICATION_EVENT_LABELS[e]).join(", ");
}

function startEditEvents(channel: NotificationChannelDto) {
  editingEventsId.value = channel.id;
  editingEvents.value = channel.events ? [...channel.events] : [];
}

async function saveEvents(channelId: string) {
  savingEvents.value = true;
  try {
    const res = await api.put<{ channel: NotificationChannelDto }>(`/teams/${teamId}/notifications/${channelId}`, {
      events: editingEvents.value.length > 0 ? editingEvents.value : null,
    });
    const index = channels.value.findIndex((c) => c.id === channelId);
    if (index !== -1) channels.value[index] = res.channel;
    editingEventsId.value = null;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar eventos";
  } finally {
    savingEvents.value = false;
  }
}

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
      events: form.value.events.length > 0 ? form.value.events : null,
    });
    channels.value.push(res.channel);
    form.value = { name: "", type: "discord", url: "", telegramBotToken: "", telegramChatId: "", events: [] };
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
        <p>Alertas de deploy, backup, servidor e uso de recursos — escolha por canal quais tipos recebe (padrão: todos).</p>
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
              <th>Eventos</th>
              <th>Ativo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="channel in channels" :key="channel.id">
              <tr>
                <td><strong>{{ channel.name }}</strong></td>
                <td>{{ typeLabel[channel.type] }}</td>
                <td>
                  <span class="hint">{{ eventsSummary(channel.events) }}</span>
                  <button type="button" class="btn btn-secondary btn-sm" style="margin-left: 6px" @click="startEditEvents(channel)">
                    <span class="material-symbols-outlined" style="font-size: 14px">tune</span>
                  </button>
                </td>
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
              <tr v-if="editingEventsId === channel.id">
                <td colspan="5">
                  <div style="display: flex; flex-wrap: wrap; gap: 12px">
                    <label v-for="eventType in EVENT_TYPES" :key="eventType" style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px">
                      <input type="checkbox" :value="eventType" v-model="editingEvents" />
                      {{ NOTIFICATION_EVENT_LABELS[eventType] }}
                    </label>
                  </div>
                  <p class="hint" style="margin-top: 6px">Nenhum marcado = recebe todos os eventos.</p>
                  <div class="btn-row mt-16" style="margin-top: 8px">
                    <button type="button" class="btn btn-secondary btn-sm" :disabled="savingEvents" @click="saveEvents(channel.id)">
                      {{ savingEvents ? "salvando..." : "Salvar" }}
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" @click="editingEventsId = null">Cancelar</button>
                  </div>
                </td>
              </tr>
            </template>
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
          <div class="form-group">
            <label>Eventos (nenhum marcado = todos)</label>
            <div style="display: flex; flex-wrap: wrap; gap: 12px">
              <label v-for="eventType in EVENT_TYPES" :key="eventType" style="display: inline-flex; align-items: center; gap: 6px; font-size: 13px">
                <input type="checkbox" :value="eventType" v-model="form.events" />
                {{ NOTIFICATION_EVENT_LABELS[eventType] }}
              </label>
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
