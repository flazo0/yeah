<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isDark } from "../lib/theme";

const props = defineProps<{ log: string }>();

const container = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let written = 0;

function themeFor(dark: boolean): ITheme {
  return dark
    ? {
        background: "#000000",
        foreground: "#f5f5f5",
        cursor: "#00000000",
        black: "#1a1a1a",
        red: "#ff6b6b",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#e879f9",
        cyan: "#22d3ee",
        white: "#e5e5e5",
      }
    : {
        background: "#ffffff",
        foreground: "#0a0a0a",
        cursor: "#00000000",
        black: "#1a1a1a",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#b45309",
        blue: "#2563eb",
        magenta: "#c026d3",
        cyan: "#0891b2",
        white: "#404040",
      };
}

function writeNew(log: string) {
  if (!term) return;
  if (log.length < written) {
    term.reset();
    written = 0;
  }
  if (log.length > written) {
    term.write(log.slice(written).replace(/\n/g, "\r\n"));
    written = log.length;
  }
}

onMounted(() => {
  if (!container.value) return;
  term = new Terminal({
    fontFamily: "'Google Sans Code', ui-monospace, monospace",
    fontSize: 12,
    disableStdin: true,
    theme: themeFor(isDark.value),
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container.value);
  fit.fit();
  writeNew(props.log);
});

watch(() => props.log, writeNew);
watch(isDark, (dark) => {
  if (term) term.options.theme = themeFor(dark);
});

onBeforeUnmount(() => term?.dispose());

defineExpose({ fit: () => fit?.fit() });
</script>

<template>
  <div ref="container" class="h-64" style="background: var(--bg); padding: 4px 8px"></div>
</template>
