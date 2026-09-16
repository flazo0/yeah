<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const name = ref("");
const creating = ref(false);
const error = ref("");

async function createTeam() {
  if (!name.value.trim()) return;
  creating.value = true;
  error.value = "";
  try {
    await auth.createTeam(name.value.trim());
    name.value = "";
  } catch {
    error.value = "não foi possível criar o time";
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Times</h1>
        <p>Cada time tem seus próprios servidores, apps e bancos.</p>
      </div>
    </div>

    <div v-if="auth.teams.length === 0" class="card">
      <div class="card-body">
        <div class="empty-state">
          <span class="material-symbols-outlined icon">groups</span>
          Você ainda não tem nenhum time.
        </div>
      </div>
    </div>

    <div v-else class="quick-links mb-16">
      <RouterLink v-for="team in auth.teams" :key="team.id" :to="`/teams/${team.id}`" class="quick-link">
        <div class="name">
          {{ team.name }}
          <span class="badge badge-neutral">{{ team.role }}</span>
        </div>
        <div class="desc">{{ team.personal ? "Time pessoal" : "Time compartilhado" }}</div>
      </RouterLink>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">add</span>
        Criar novo time
      </div>
      <div class="card-body">
        <form class="form-row" style="align-items: end" @submit.prevent="createTeam">
          <div class="form-group" style="margin-bottom: 0">
            <label for="team-name">Nome do time</label>
            <input id="team-name" v-model="name" class="form-control" placeholder="Ex: Minha empresa" />
          </div>
          <button type="submit" class="btn" :disabled="creating">
            {{ creating ? "criando..." : "Criar time" }}
          </button>
        </form>
        <div v-if="error" class="alert alert-error" style="margin-top: 12px">{{ error }}</div>
      </div>
    </div>
  </div>
</template>
