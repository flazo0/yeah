import { ref } from "vue";

const STORAGE_KEY = "yeah:theme";

export const isDark = ref(true);

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
  // Coolify (and most self-hosted infra dashboards) default to dark on first visit — the toggle
  // still works and whatever's chosen there is what persists from then on.
  const dark = stored ? stored === "dark" : true;
  document.documentElement.classList.toggle("dark", dark);
  isDark.value = dark;
}
