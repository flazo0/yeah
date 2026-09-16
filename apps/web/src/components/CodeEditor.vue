<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as monaco from "monaco-editor";
import { isDark } from "../lib/theme";

const props = withDefaults(defineProps<{ modelValue: string; language?: string; height?: number }>(), {
  language: "plaintext",
  height: 160,
});
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const container = ref<HTMLDivElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

onMounted(() => {
  if (!container.value) return;
  editor = monaco.editor.create(container.value, {
    value: props.modelValue,
    language: props.language,
    theme: isDark.value ? "yeah-dark" : "yeah-light",
    minimap: { enabled: false },
    fontFamily: "'Google Sans Code', ui-monospace, monospace",
    fontSize: 12,
    lineNumbers: "off",
    scrollBeyondLastLine: false,
    automaticLayout: true,
    wordWrap: "on",
  });
  editor.onDidChangeModelContent(() => emit("update:modelValue", editor?.getValue() ?? ""));
});

watch(
  () => props.modelValue,
  (value) => {
    if (editor && editor.getValue() !== value) editor.setValue(value);
  },
);

// Monaco themes are global, so switching the toggle re-themes every open editor at once.
watch(isDark, (dark) => {
  monaco.editor.setTheme(dark ? "yeah-dark" : "yeah-light");
});

onBeforeUnmount(() => editor?.dispose());
</script>

<template>
  <div ref="container" class="overflow-hidden rounded-md border border-border" :style="{ height: `${height}px` }"></div>
</template>
