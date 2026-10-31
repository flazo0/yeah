<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { ProjectDto, ServerDto } from "@yeah/shared";
import { api } from "../lib/api";

const props = defineProps<{ teamId: string; servers: ServerDto[]; projects: ProjectDto[]; resourceCount: number }>();

const DISMISS_KEY = "yeah:getting-started-dismissed";
const dismissed = ref(false);
const panelDomainSet = ref<boolean | null>(null); // null = unknown, or the panel does not run on a managed server
const hasPlatformServer = ref(false);

onMounted(async () => {
  try {
    dismissed.value = localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // storage can be blocked: the card then simply stays
  }
  try {
    const res = await api.get<{ domain: string | null; platformServer: unknown | null }>(`/teams/${props.teamId}/instance/panel-domain`);
    hasPlatformServer.value = res.platformServer !== null;
    panelDomainSet.value = res.domain !== null;
  } catch {
    // the checklist works without this optional step
  }
});

function dismiss() {
  dismissed.value = true;
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // ignore
  }
}

interface Step {
  key: string;
  done: boolean;
  optional?: boolean;
  to: string;
  icon: string;
  enabled: boolean;
}

const firstServer = computed(() => props.servers[0] ?? null);
const proxyActive = computed(() => props.servers.some((s) => s.proxyStatus === "active"));

const steps = computed<Step[]>(() => {
  const t = props.teamId;
  const list: Step[] = [
    { key: "server", done: props.servers.length > 0, to: `/teams/${t}/servers/new`, icon: "dns", enabled: true },
    {
      key: "proxy",
      done: proxyActive.value,
      to: firstServer.value ? `/teams/${t}/servers/${firstServer.value.id}/proxy` : `/teams/${t}/servers`,
      icon: "hub",
      enabled: props.servers.length > 0,
    },
    { key: "resource", done: props.resourceCount > 0, to: props.projects[0] ? `/teams/${t}/projects/${props.projects[0].id}` : `/teams/${t}`, icon: "rocket_launch", enabled: props.servers.length > 0 },
  ];
  if (hasPlatformServer.value) list.push({ key: "domain", done: panelDomainSet.value === true, optional: true, to: `/teams/${t}/settings`, icon: "public", enabled: proxyActive.value });
  return list;
});

const required = computed(() => steps.value.filter((s) => !s.optional));
const doneRequired = computed(() => required.value.filter((s) => s.done).length);
const allRequiredDone = computed(() => doneRequired.value === required.value.length);
const optionalPending = computed(() => steps.value.some((s) => s.optional && !s.done));
const visible = computed(() => !dismissed.value && (!allRequiredDone.value || optionalPending.value));
// the first step that is not done and can be done now
const nextKey = computed(() => steps.value.find((s) => !s.done && s.enabled)?.key ?? null);
</script>

<template>
  <div v-if="visible" class="card mb-16">
    <div class="card-header" style="justify-content: space-between">
      <span style="display: flex; align-items: center; gap: 8px">
        <span class="material-symbols-outlined" style="font-size: 18px">flag</span>
        {{ allRequiredDone ? $t("gettingStarted.titleDone") : $t("gettingStarted.title") }}
      </span>
      <button type="button" class="btn btn-secondary btn-sm" @click="dismiss">{{ $t("gettingStarted.dismiss") }}</button>
    </div>
    <div class="card-body">
      <p class="hint mb-16">{{ allRequiredDone ? $t("gettingStarted.hintDone") : $t("gettingStarted.hint", { done: doneRequired, total: required.length }) }}</p>
      <ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">
        <li v-for="step in steps" :key="step.key" style="display: flex; align-items: flex-start; gap: 12px">
          <span class="material-symbols-outlined" :style="{ fontSize: '22px', color: step.done ? 'var(--accent, #46a758)' : 'var(--text-muted, #8b8b8b)' }" aria-hidden="true">
            {{ step.done ? "check_circle" : "radio_button_unchecked" }}
          </span>
          <div style="flex: 1; min-width: 0">
            <strong :style="{ textDecoration: step.done ? 'line-through' : 'none', opacity: step.done ? 0.6 : 1 }">
              {{ $t(`gettingStarted.steps.${step.key}.title`) }}
              <span v-if="step.optional" class="muted" style="font-weight: normal">({{ $t("gettingStarted.optional") }})</span>
            </strong>
            <div class="hint">{{ $t(`gettingStarted.steps.${step.key}.hint`) }}</div>
          </div>
          <RouterLink v-if="!step.done && step.enabled" :to="step.to" class="btn btn-sm" :class="step.key === nextKey ? 'btn-primary' : 'btn-secondary'">
            {{ $t(`gettingStarted.steps.${step.key}.action`) }}
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>
