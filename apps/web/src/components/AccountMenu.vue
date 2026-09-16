<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLDivElement | null>(null);

function toggle() {
  open.value = !open.value;
}

function onDocumentClick(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick));

async function handleLogout() {
  await auth.logout();
  router.push("/login");
}

const initial = () => (auth.user?.name?.charAt(0) || auth.user?.email?.charAt(0) || "?").toUpperCase();
</script>

<template>
  <div ref="root" class="account-menu">
    <button type="button" class="account-menu-trigger" @click="toggle">
      <span class="avatar">{{ initial() }}</span>
      <span class="material-symbols-outlined" style="font-size: 18px">expand_more</span>
    </button>
    <div v-if="open" class="account-menu-panel">
      <div class="account-menu-current">
        <span class="avatar">{{ initial() }}</span>
        <div class="account-menu-info">
          <strong>{{ auth.user?.name || auth.user?.email }}</strong>
          <span>{{ auth.user?.email }}</span>
        </div>
      </div>
      <div class="account-menu-divider"></div>
      <RouterLink to="/dashboard" class="account-menu-item" @click="open = false">
        <span class="material-symbols-outlined" style="font-size: 18px">space_dashboard</span>
        Times
      </RouterLink>
      <button type="button" class="account-menu-item danger" @click="handleLogout">
        <span class="material-symbols-outlined" style="font-size: 18px">logout</span>
        Sair
      </button>
    </div>
  </div>
</template>
