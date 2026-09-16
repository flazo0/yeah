<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../lib/api";
import Logo from "../components/Logo.vue";

const name = ref("");
const email = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);
const auth = useAuthStore();
const router = useRouter();

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    await auth.register(email.value, password.value, name.value || undefined);
    router.push("/dashboard");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "não foi possível criar a conta";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-shell">
    <div class="auth-form-card">
      <div class="auth-logo">
        <Logo :height="44" />
      </div>
      <div class="auth-form-head">
        <h1>Criar conta</h1>
        <p>Seu time pessoal é criado automaticamente.</p>
      </div>
      <form @submit.prevent="submit">
        <div class="form-group">
          <label for="name">Nome</label>
          <div class="input-icon">
            <span class="material-symbols-outlined">badge</span>
            <input id="name" v-model="name" type="text" class="form-control form-control-lg" placeholder="Seu nome" />
          </div>
        </div>
        <div class="form-group">
          <label for="email">Email</label>
          <div class="input-icon">
            <span class="material-symbols-outlined">mail</span>
            <input
              id="email"
              v-model="email"
              type="email"
              class="form-control form-control-lg"
              placeholder="seu@email.com"
              required
              autocomplete="email"
            />
          </div>
        </div>
        <div class="form-group">
          <label for="password">Senha (mín. 8 caracteres)</label>
          <div class="input-icon">
            <span class="material-symbols-outlined">lock</span>
            <input
              id="password"
              v-model="password"
              type="password"
              class="form-control form-control-lg"
              placeholder="Sua senha"
              required
              minlength="8"
              autocomplete="new-password"
            />
          </div>
        </div>
        <div v-if="error" class="alert alert-error">{{ error }}</div>
        <button type="submit" class="btn btn-lg btn-block" :disabled="loading">
          {{ loading ? "criando..." : "Criar conta" }}
        </button>
      </form>
      <p style="margin-top: 16px; text-align: center; font-size: 13px; color: var(--ink-dim)">
        Já tem conta? <RouterLink to="/login" class="label-link">Entrar</RouterLink>
      </p>
    </div>
  </div>
</template>
