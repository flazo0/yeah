<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{ preDeployCommand: string | null; postDeployCommand: string | null; putUrl: string }>();
const emit = defineEmits<{ saved: [{ preDeployCommand: string | null; postDeployCommand: string | null }]; error: [string] }>();

const pre = ref("");
const post = ref("");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  pre.value = props.preDeployCommand ?? "";
  post.value = props.postDeployCommand ?? "";
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const res = await api.put<{ application: { preDeployCommand: string | null; postDeployCommand: string | null } }>(props.putUrl, {
      preDeployCommand: pre.value.trim() || null,
      postDeployCommand: post.value.trim() || null,
    });
    emit("saved", { preDeployCommand: res.application.preDeployCommand, postDeployCommand: res.application.postDeployCommand });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("deployCommands.failedToSave"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">terminal</span>
    {{ $t("deployCommands.title") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">{{ $t("deployCommands.hint") }}</p>
    <div class="form-group">
      <label for="pre-deploy-command">{{ $t("deployCommands.pre") }}</label>
      <input id="pre-deploy-command" v-model="pre" type="text" class="form-control mono" placeholder="npx prisma migrate deploy" maxlength="1000" autocomplete="off" spellcheck="false" />
      <p class="hint" style="margin-top: 6px">{{ $t("deployCommands.preHint") }}</p>
    </div>
    <div class="form-group">
      <label for="post-deploy-command">{{ $t("deployCommands.post") }}</label>
      <input id="post-deploy-command" v-model="post" type="text" class="form-control mono" placeholder="php artisan cache:clear" maxlength="1000" autocomplete="off" spellcheck="false" />
      <p class="hint" style="margin-top: 6px">{{ $t("deployCommands.postHint") }}</p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("resourceLimitsCard.saving") : $t("common.save") }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ $t("deployCommands.saved") }}</span>
    </div>
  </div>
</template>
