<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isDark } from "../lib/theme";

defineProps<{ serverName: string }>();

const container = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;

function themeFor(dark: boolean): ITheme {
  // Background/foreground follow the page theme; ANSI colors stay a real terminal palette.
  return dark
    ? {
        background: "#000000",
        foreground: "#f5f5f5",
        cursor: "#f5f5f5",
        selectionBackground: "#2dd4c055",
        black: "#1a1a1a",
        red: "#ff6b6b",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#e879f9",
        cyan: "#22d3ee",
        white: "#e5e5e5",
        brightBlack: "#525252",
        brightRed: "#ff8787",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#f0abfc",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      }
    : {
        background: "#ffffff",
        foreground: "#0a0a0a",
        cursor: "#0a0a0a",
        selectionBackground: "#0e8c8233",
        black: "#1a1a1a",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#b45309",
        blue: "#2563eb",
        magenta: "#c026d3",
        cyan: "#0891b2",
        white: "#404040",
        brightBlack: "#737373",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#ca8a04",
        brightBlue: "#3b82f6",
        brightMagenta: "#d946ef",
        brightCyan: "#06b6d4",
        brightWhite: "#171717",
      };
}

onMounted(() => {
  if (!container.value) return;
  term = new Terminal({
    fontFamily: "'Google Sans Code', ui-monospace, monospace",
    fontSize: 12,
    cursorBlink: true,
    theme: themeFor(isDark.value),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container.value);
  fit.fit();

  term.writeln("\x1b[36m# preview local\x1b[0m \x1b[90m— exec real por SSH chega na Fase 4 do roadmap\x1b[0m");
  term.write("\x1b[32m$\x1b[0m ");

  let line = "";
  term.onData((data) => {
    if (data === "\r") {
      term?.write("\r\n\x1b[32m$\x1b[0m ");
      line = "";
      return;
    }
    if (data === "") {
      if (line.length > 0) {
        line = line.slice(0, -1);
        term?.write("\b \b");
      }
      return;
    }
    line += data;
    term?.write(data);
  });
});

watch(isDark, (dark) => {
  if (term) term.options.theme = themeFor(dark);
});

onBeforeUnmount(() => term?.dispose());
</script>

<template>
  <details class="card" style="margin-bottom: 0">
    <summary class="card-header" style="cursor: pointer">
      <span class="material-symbols-outlined" style="font-size: 16px">terminal</span>
      Terminal — {{ serverName }}
    </summary>
    <div ref="container" class="h-40" style="background: var(--bg); padding: 4px 8px"></div>
  </details>
</template>
