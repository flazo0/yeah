<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ currentName: string }>();

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLDivElement | null>(null);

const creating = ref(false);
const showCreateForm = ref(false);
const newTeamName = ref("");
const error = ref("");

function toggle() {
  open.value = !open.value;
  if (!open.value) {
    showCreateForm.value = false;
    error.value = "";
  }
}

function onDocumentClick(event: MouseEvent) {
  // composedPath() (captured at dispatch time) rather than event.target — the "Novo time" button
  // is itself replaced by the inline form as a reactive side effect of this same click, so by the
  // time the event bubbles to document, event.target may already be a detached node that
  // root.contains() would wrongly report as "outside".
  if (root.value && !event.composedPath().includes(root.value)) {
    open.value = false;
    showCreateForm.value = false;
  }
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick));

function switchTeam(teamId: string) {
  open.value = false;
  router.push(`/teams/${teamId}`);
}

async function createTeam() {
  if (!newTeamName.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    const team = await auth.createTeam(newTeamName.value.trim());
    newTeamName.value = "";
    showCreateForm.value = false;
    open.value = false;
    router.push(`/teams/${team.id}`);
  } catch {
    error.value = "não foi possível criar o time";
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div ref="root" class="account-menu">
    <button type="button" class="crumb-item crumb-dropdown" @click="toggle">
      {{ currentName }}
      <span class="material-symbols-outlined" style="font-size: 16px">expand_more</span>
    </button>
    <div v-if="open" class="account-menu-panel" style="left: 0; right: auto; width: 260px">
      <div
        v-for="team in auth.teams"
        :key="team.id"
        class="account-menu-item"
        :class="{ active: team.id === route.params.teamId }"
        style="cursor: pointer"
        @click="switchTeam(team.id)"
      >
        <span class="material-symbols-outlined" style="font-size: 18px">groups</span>
        {{ team.name }}
        <span v-if="team.id === route.params.teamId" class="material-symbols-outlined" style="font-size: 16px; margin-left: auto">check</span>
      </div>
      <div class="account-menu-divider"></div>
      <template v-if="!showCreateForm">
        <button type="button" class="account-menu-item" @click="showCreateForm = true">
          <span class="material-symbols-outlined" style="font-size: 18px">add</span>
          Novo time
        </button>
      </template>
      <form v-else class="account-menu-create-form" @submit.prevent="createTeam">
        <input v-model="newTeamName" class="form-control" placeholder="Nome do time" autofocus />
        <button type="submit" class="btn btn-secondary btn-sm" :disabled="creating">
          {{ creating ? "criando..." : "Criar" }}
        </button>
      </form>
      <div v-if="error" class="alert alert-error" style="margin: 6px; font-size: 12px; padding: 6px 8px">{{ error }}</div>
    </div>
  </div>
</template>
