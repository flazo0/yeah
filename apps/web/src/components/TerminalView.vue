<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isDark } from "../lib/theme";
import { apiWsBase } from "../lib/api";

// A real terminal: keystrokes go to the API over a WebSocket, which relays them to an SSH PTY
// (a login shell on the server, or `docker exec -it` into the app's container).
const props = defineProps<{ path: string; title: string }>();

const container = ref<HTMLDivElement | null>(null);
const state = ref<"connecting" | "open" | "closed">("connecting");
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let socket: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;

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


function sendResize() {
  if (!term || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
}

function connect() {
  if (!term) return;
  socket?.close();
  state.value = "connecting";
  term.reset();
  term.writeln("\x1b[90mconectando...\x1b[0m");
  const ws = new WebSocket(`${apiWsBase()}${props.path}`);
  socket = ws;
  let first = true;
  ws.onopen = () => {
    state.value = "open";
    sendResize();
  };
  ws.onmessage = (event) => {
    if (first) {
      first = false;
      term?.reset();
      // The server only starts listening once it authenticated and opened the PTY — tell it the real size then.
      sendResize();
    }
    term?.write(String(event.data));
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    state.value = "closed";
    term?.writeln("\r\n\x1b[90m[conexão encerrada]\x1b[0m");
  };
}

onMounted(() => {
  if (!container.value) return;
  term = new Terminal({
    fontFamily: "'Google Sans Code', ui-monospace, monospace",
    fontSize: 13,
    cursorBlink: true,
    theme: themeFor(isDark.value),
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container.value);
  fit.fit();
  term.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
  });
  term.onResize(() => sendResize());
  resizeObserver = new ResizeObserver(() => fit?.fit());
  resizeObserver.observe(container.value);
  connect();
});

watch(isDark, (dark) => {
  if (term) term.options.theme = themeFor(dark);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  const ws = socket;
  socket = null;
  ws?.close();
  term?.dispose();
});
</script>

<template>
  <div class="card" style="margin-bottom: 0">
    <div class="card-header">
      <span class="material-symbols-outlined" style="font-size: 16px">terminal</span>
      {{ title }}
      <button v-if="state === 'closed'" type="button" class="btn btn-secondary btn-sm" style="margin-left: auto" @click="connect">Reconectar</button>
    </div>
    <div ref="container" class="terminal-box"></div>
  </div>
</template>
