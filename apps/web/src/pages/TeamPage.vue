<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import Modal from "../components/Modal.vue";
import { i18n } from "../lib/i18n";
import { dateLocale } from "../lib/i18n";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const teamId = route.params.teamId as string;

const team = computed(() => auth.teams.find((t) => t.id === teamId) ?? null);
const name = ref(team.value?.name ?? "");
const description = ref(team.value?.description ?? "");
watch(team, (t, previous) => {
  if (t && !previous) {
    name.value = t.name;
    description.value = t.description ?? "";
  }
});

const saving = ref(false);
const saved = ref(false);
const error = ref("");

const showCreate = ref(false);
const newName = ref("");
const creating = ref(false);

async function save() {
  if (!name.value.trim()) return;
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    await auth.updateTeam(teamId, { name: name.value.trim(), description: description.value });
    saved.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("team.falhaAoSalvar");
  } finally {
    saving.value = false;
  }
}

async function createTeam() {
  if (!newName.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const created = await auth.createTeam(newName.value.trim());
    showCreate.value = false;
    newName.value = "";
    router.push(`/teams/${created.id}/team`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : i18n.global.t("team.falhaAoCriarTime");
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>{{ $t("team.time") }}</h1>
        <p>{{ $t("team.umTimeAgrupaProjetosServidores") }}</p>
      </div>
      <button type="button" class="btn btn-secondary" @click="showCreate = true">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        {{ $t("team.novoTime") }}
      </button>
    </div>

    <div v-if="error && !showCreate" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!team" class="empty-state">{{ $t("team.timeNaoEncontrado") }}</div>
    <div v-else class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">group</span>
        {{ $t("team.geral") }}
      </div>
      <div class="card-body">
        <form @submit.prevent="save">
          <div class="form-group">
            <label for="team-name">{{ $t("team.nome") }}</label>
            <input id="team-name" v-model="name" class="form-control" required maxlength="255" />
          </div>
          <div class="form-group">
            <label for="team-description">{{ $t("team.descricao") }}</label>
            <textarea id="team-description" v-model="description" class="form-control" maxlength="1000" :placeholder="$t('team.praQueServeEsseTime')"></textarea>
          </div>
          <dl class="kv-list mb-16">
            <div><dt>{{ $t("team.seuPapel") }}</dt><dd>{{ team.role }}</dd></div>
            <div><dt>{{ $t("team.criadoEm") }}</dt><dd>{{ new Date(team.createdAt).toLocaleDateString(dateLocale()) }}</dd></div>
          </dl>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="saving || (name.trim() === team.name && description.trim() === (team.description ?? ''))">
              {{ saving ? $t("team.salvando") : "Salvar" }}
            </button>
            <span v-if="saved" class="muted" style="align-self: center">{{ $t("team.salvo") }}</span>
          </div>
        </form>
      </div>
    </div>

    <Modal v-if="showCreate" :title="$t('team.novoTime')" @close="showCreate = false">
      <form @submit.prevent="createTeam">
        <div class="form-group">
          <label for="new-team-name">{{ $t("team.nome") }}</label>
          <input id="new-team-name" v-model="newName" class="form-control" required autofocus />
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="creating">{{ creating ? $t("team.criando") : $t("team.criarTime") }}</button>
          <button type="button" class="btn btn-secondary" @click="showCreate = false">{{ $t("team.cancelar") }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
