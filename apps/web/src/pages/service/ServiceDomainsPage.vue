<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { StackDomain } from "@yeah/shared";
import { api, ApiError } from "../../lib/api";
import { useServiceContext } from "../../composables/useServiceContext";

const { service, basePath, error, reloadService } = useServiceContext();

const rows = ref<StackDomain[]>([]);
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  if (service.value) rows.value = service.value.domains.map((d) => ({ ...d }));
});

function add() {
  const first = service.value?.mainService ?? service.value?.stackServices[0] ?? "";
  rows.value.push({ service: first, domain: "", port: service.value?.port ?? 80 });
}

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = "";
  try {
    await api.put(`${basePath}/domains`, { domains: rows.value.filter((r) => r.domain.trim()) });
    await reloadService();
    saved.value = true;
    setTimeout(() => (saved.value = false), 3000);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "falha ao salvar os domínios";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div v-if="service" class="card" style="margin-bottom: 0">
    <div class="card-header"><span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span> Domínios por container</div>
    <div class="card-body">
      <p class="hint mb-16">
        Cada linha liga um domínio a um container da stack e à porta em que ele escuta. Vários domínios podem apontar pro mesmo container (portas diferentes: app e painel).
        Precisa do proxy ativo no servidor. O DNS de cada domínio tem que apontar pro servidor. Vale no próximo Reimplantar.
      </p>
      <div class="env-table-wrap">
        <table class="env-table">
          <thead><tr><th>Container</th><th>Domínio</th><th>Porta</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="i">
              <td data-label="Container">
                <select v-model="row.service" class="form-control" :aria-label="`Container da linha ${i + 1}`">
                  <option v-for="s in service.stackServices" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>
              <td data-label="Domínio"><input v-model="row.domain" class="form-control mono" placeholder="app.exemplo.com" :aria-label="`Domínio da linha ${i + 1}`" /></td>
              <td data-label="Porta"><input v-model.number="row.port" type="number" min="1" max="65535" class="form-control" style="max-width: 110px" :aria-label="`Porta da linha ${i + 1}`" /></td>
              <td>
                <button type="button" class="rtable-delete" title="Remover" aria-label="Remover domínio" @click="rows.splice(i, 1)"><span class="material-symbols-outlined">delete</span></button>
              </td>
            </tr>
            <tr v-if="rows.length === 0"><td colspan="4" class="muted">Sem domínio: os containers só respondem dentro da rede do ambiente (e nas portas que o compose publicar).</td></tr>
          </tbody>
        </table>
      </div>
      <div class="btn-row" style="margin-top: 12px">
        <button type="button" class="btn btn-secondary btn-sm" @click="add"><span class="material-symbols-outlined" style="font-size: 16px">add</span> Adicionar domínio</button>
        <button type="button" class="btn" :disabled="saving" @click="save"><span class="material-symbols-outlined" style="font-size: 18px">save</span> {{ saving ? "salvando..." : "Salvar" }}</button>
        <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">salvo — clique em Reimplantar pra aplicar</span>
      </div>
    </div>
  </div>
</template>
