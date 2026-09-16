import { createApp } from "vue";
import { createPinia } from "pinia";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import App from "./App.vue";
import { router } from "./router";
import { initTheme } from "./lib/theme";
import "./styles/main.css";

// Monaco needs a worker for tokenization/layout even for plain-text buffers.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Editors/terminals mirror the page's own theme instead of a fixed dark chrome.
monaco.editor.defineTheme("yeah-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#0a0a0a",
    "editorLineNumber.foreground": "#c4c4c8",
    "editor.lineHighlightBackground": "#00000000",
  },
});
monaco.editor.defineTheme("yeah-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#000000",
    "editor.foreground": "#f5f5f5",
    "editorLineNumber.foreground": "#3a3a3d",
    "editor.lineHighlightBackground": "#00000000",
  },
});

// Applied before mount to avoid a flash of the wrong theme on load.
initTheme();

createApp(App).use(createPinia()).use(router).mount("#app");
