<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../lib/api";
import { isDark, toggleTheme } from "../lib/theme";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const auth = useAuthStore();
const teamId = (route.params.teamId as string | undefined) ?? auth.teams[0]?.id;

interface PlatformInfo {
  currentCommit?: string | null;
  latestCommit?: string | null;
  updateAvailable?: boolean;
}
const platform = ref<PlatformInfo | null>(null);

onMounted(async () => {
  try {
    platform.value = await api.get<PlatformInfo>("/updates/platform");
  } catch {
    platform.value = null;
  }
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Configurações</h1>
        <p>Preferências desta instância e da sua conta.</p>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">palette</span>
        Aparência
      </div>
      <div class="card-body">
        <div class="btn-row" style="align-items: center; justify-content: space-between">
          <div>
            <strong>Tema</strong>
            <p class="hint" style="margin: 2px 0 0">Escuro é o padrão; a escolha fica salva neste navegador.</p>
          </div>
          <button type="button" class="btn btn-secondary" @click="toggleTheme">
            <span class="material-symbols-outlined" style="font-size: 18px">{{ isDark ? "dark_mode" : "light_mode" }}</span>
            {{ isDark ? "Escuro" : "Claro" }}
          </button>
        </div>
      </div>
    </div>

    <div class="card mb-16">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">deployed_code_update</span>
        Versão da plataforma
      </div>
      <div class="card-body">
        <dl class="kv-list">
          <div><dt>Commit atual</dt><dd class="mono">{{ platform?.currentCommit?.slice(0, 7) ?? "-" }}</dd></div>
          <div><dt>Última no GitHub</dt><dd class="mono">{{ platform?.latestCommit?.slice(0, 7) ?? "-" }}</dd></div>
        </dl>
        <div v-if="teamId" class="btn-row" style="margin-top: 16px">
          <RouterLink :to="`/teams/${teamId}/updates`" class="btn btn-secondary">
            <span class="material-symbols-outlined" style="font-size: 18px">arrow_forward</span>
            Ir pra Atualizações
          </RouterLink>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="material-symbols-outlined" style="font-size: 18px">person</span>
        Conta
      </div>
      <div class="card-body">
        <dl class="kv-list">
          <div><dt>Nome</dt><dd>{{ auth.user?.name || "-" }}</dd></div>
          <div><dt>E-mail</dt><dd>{{ auth.user?.email }}</dd></div>
        </dl>
      </div>
    </div>
  </div>
</template>
