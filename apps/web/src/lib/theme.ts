import { ref } from "vue";

const STORAGE_KEY = "yeah:theme";

export const isDark = ref(false);

function persist(dark: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // private browsing / blocked storage — theme just won't survive a reload
  }
}

export function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  isDark.value = dark;
  persist(dark);
}

export function toggleTheme() {
  applyTheme(!isDark.value);
}

export function initTheme() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  const dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
  isDark.value = dark;
}
