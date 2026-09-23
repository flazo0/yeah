<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ServerDto } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import CodeEditor from "../components/CodeEditor.vue";

const route = useRoute();
const router = useRouter();
const teamId = route.params.teamId as string;

const form = ref({ name: "", host: "", port: 22, sshUser: "root", privateKey: "" });
const submitting = ref(false);
const error = ref("");

async function addServer() {
  submitting.value = true;
  error.value = "";
  try {
    const res = await api.post<{ server: ServerDto }>(`/teams/${teamId}/servers`, form.value);
    router.push(`/teams/${teamId}/servers/${res.server.id}/general`);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao criar servidor";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <nav class="breadcrumb">
      <RouterLink :to="`/teams/${teamId}/servers`" class="breadcrumb-item">Servidores</RouterLink>
      <span class="breadcrumb-sep">›</span>
      <span class="breadcrumb-current">Adicionar servidor</span>
    </nav>
    <div class="page-header">
      <div>
        <h1>Adicionar servidor</h1>
        <p>Conecte uma máquina via SSH pra começar a fazer deploy nela.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-body">
        <form @submit.prevent="addServer">
          <div class="form-row mb-16">
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-name">Nome</label>
              <input id="server-name" v-model="form.name" class="form-control" placeholder="vps-producao" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-host">Host / IP</label>
              <input id="server-host" v-model="form.host" class="form-control" placeholder="203.0.113.10" required />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-port">Porta</label>
              <input id="server-port" v-model.number="form.port" type="number" class="form-control" placeholder="22" />
            </div>
            <div class="form-group" style="margin-bottom: 0">
              <label for="server-user">Usuário SSH</label>
              <input id="server-user" v-model="form.sshUser" class="form-control" placeholder="root" />
            </div>
          </div>
          <div class="form-group">
            <label>Chave privada SSH</label>
            <CodeEditor v-model="form.privateKey" :height="160" />
          </div>
          <div v-if="error" class="alert alert-error">{{ error }}</div>
          <button type="submit" class="btn" :disabled="submitting">
            <span class="material-symbols-outlined" style="font-size: 18px">add</span>
            {{ submitting ? "adicionando..." : "Adicionar servidor" }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
