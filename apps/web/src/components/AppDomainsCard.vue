<script setup lang="ts">
import { ref, watchEffect } from "vue";
import type { WwwRedirect } from "@yeah/shared";
import { api, ApiError } from "../lib/api";
import { i18n } from "../lib/i18n";

const props = defineProps<{
  domain: string | null;
  extraDomains: string[];
  wwwRedirect: WwwRedirect;
  putUrl: string;
  savedMessage: string;
  /** Domain the server's wildcard would give this app; enables the "Generate domain" button. */
  suggestion?: string | null;
}>();
const emit = defineEmits<{ saved: [{ domain: string | null; extraDomains: string[]; wwwRedirect: WwwRedirect }]; error: [string] }>();

const primary = ref("");
const extra = ref("");
const redirect = ref<WwwRedirect>("none");
const saving = ref(false);
const saved = ref(false);

watchEffect(() => {
  primary.value = props.domain ?? "";
  extra.value = props.extraDomains.join("\n");
  redirect.value = props.wwwRedirect;
});

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    const extraDomains = extra.value.split(/[\s,]+/).filter(Boolean);
    const res = await api.put<{ application: { domain: string | null; extraDomains: string[]; wwwRedirect: WwwRedirect } }>(props.putUrl, {
      domain: primary.value,
      extraDomains,
      wwwRedirect: primary.value ? redirect.value : "none",
    });
    emit("saved", { domain: res.application.domain, extraDomains: res.application.extraDomains, wwwRedirect: res.application.wwwRedirect });
    saved.value = true;
    setTimeout(() => (saved.value = false), 2500);
  } catch (err) {
    emit("error", err instanceof ApiError ? err.message : i18n.global.t("appDomainsCard.failedSaveDomain"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="card-header" style="border-top: 1px solid var(--border)">
    <span class="material-symbols-outlined" style="font-size: 18px">shield_lock</span>
    {{ $t("appDomainsCard.domains") }}
  </div>
  <div class="card-body">
    <p class="hint mb-16">
      {{ $t("appDomainsCard.leaveBlankUseServerS") }}
    </p>
    <div class="form-group">
      <label for="app-domain">{{ $t("appDomainsCard.primaryDomain") }}</label>
      <input id="app-domain" v-model="primary" class="form-control mono" :placeholder="$t('appDomainsCard.myappExampleCom')" />
      <p v-if="suggestion" class="hint" style="margin-top: 6px">
        {{ $t("appDomainsCard.theServerSWildcardSuggests") }} <span class="mono">{{ suggestion }}</span>
        <button type="button" class="label-link" style="background: none; border: none; cursor: pointer; padding: 0" @click="primary = suggestion">{{ $t("appDomainsCard.generateDomain") }}</button>
      </p>
    </div>
    <div class="form-group">
      <label for="app-extra-domains">{{ $t("appDomainsCard.additionalDomains") }}</label>
      <textarea id="app-extra-domains" v-model="extra" class="form-control mono" rows="3" :placeholder="$t('appDomainsCard.onePerLineCommaSeparated')"></textarea>
      <p class="hint" style="margin-top: 6px">{{ $t("appDomainsCard.theyServeSameContentPrimary") }}</p>
    </div>
    <div class="form-group">
      <label for="app-www">{{ $t("appDomainsCard.wwwRedirect") }}</label>
      <select id="app-www" v-model="redirect" class="form-control" :disabled="!primary">
        <option value="none">{{ $t("appDomainsCard.noRedirect") }}</option>
        <option value="www_to_root">{{ $t("appDomainsCard.wwwDomainDomainNoWww") }}</option>
        <option value="root_to_www">{{ $t("appDomainsCard.domainWwwDomain") }}</option>
      </select>
      <p class="hint" style="margin-top: 6px">{{ $t("appDomainsCard.redirects301OtherFormPrimary") }}</p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" :disabled="saving" @click="save">
        <span class="material-symbols-outlined" style="font-size: 18px">save</span>
        {{ saving ? $t("appDomainsCard.saving") : $t("common.save") }}
      </button>
      <span v-if="saved" class="muted" style="align-self: center; font-size: 13px">{{ savedMessage }}</span>
    </div>
  </div>
</template>
