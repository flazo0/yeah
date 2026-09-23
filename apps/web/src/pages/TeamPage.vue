<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";
import Modal from "../components/Modal.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const teamId = route.params.teamId as string;

const team = computed(() => auth.teams.find((t) => t.id === teamId) ?? null);
const name = ref(team.value?.name ?? "");
watch(team, (t) => {
  if (t && !name.value) name.value = t.name;
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
    await auth.renameTeam(teamId, name.value.trim());
    saved.value = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar";
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
    error.value = err instanceof ApiError ? err.message : "falha ao criar time";
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Time</h1>
        <p>Um time agrupa projetos, servidores e integrações. Como o painel tem um único administrador, aqui não há convite de membros.</p>
      </div>
      <button type="button" class="btn btn-secondary" @click="showCreate = true">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Novo time
      </button>
    </div>

    <div v-if="error && !showCreate" class="alert alert-error mb-16">{{ error }}</div>

    <div v-if="!team" class="empty-state">Time não encontrado.</div>
    <div v-else class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">group</span>
        Geral
      </div>
      <div class="card-body">
        <form @submit.prevent="save">
          <div class="form-group">
            <label for="team-name">Nome</label>
            <input id="team-name" v-model="name" class="form-control" required maxlength="255" />
          </div>
          <dl class="kv-list mb-16">
            <div><dt>Seu papel</dt><dd>{{ team.role }}</dd></div>
            <div><dt>Criado em</dt><dd>{{ new Date(team.createdAt).toLocaleDateString("pt-BR") }}</dd></div>
          </dl>
          <div class="btn-row">
            <button type="submit" class="btn" :disabled="saving || name.trim() === team.name">
              {{ saving ? "salvando..." : "Salvar" }}
            </button>
            <span v-if="saved" class="muted" style="align-self: center">salvo</span>
          </div>
        </form>
      </div>
    </div>

    <Modal v-if="showCreate" title="Novo time" @close="showCreate = false">
      <form @submit.prevent="createTeam">
        <div class="form-group">
          <label for="new-team-name">Nome</label>
          <input id="new-team-name" v-model="newName" class="form-control" required autofocus />
        </div>
        <div v-if="error" class="alert alert-error mb-16">{{ error }}</div>
        <div class="btn-row">
          <button type="submit" class="btn" :disabled="creating">{{ creating ? "criando..." : "Criar time" }}</button>
          <button type="button" class="btn btn-secondary" @click="showCreate = false">Cancelar</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
