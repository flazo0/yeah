import { createI18n } from "vue-i18n";
import pt from "../locales/pt.json";
import en from "../locales/en.json";

export const LOCALES = ["pt", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = "yeah:locale";

export function pickLocale(stored: string | null, navigatorLanguage: string | undefined): Locale {
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  return navigatorLanguage?.toLowerCase().startsWith("en") ? "en" : "pt";
}

function initialLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // blocked storage — falls back to the browser language
  }
  return pickLocale(stored, typeof navigator === "undefined" ? undefined : navigator.language);
}

// Pages not migrated yet are still hard-coded Portuguese; keys missing from a locale fall back to pt.
export const i18n = createI18n({ legacy: false, locale: initialLocale(), fallbackLocale: "pt", messages: { pt, en } });

export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // preference just won't persist
  }
}

/** Locale tag for Intl/toLocale*String, following the UI language. */
export function dateLocale(): string {
  return i18n.global.locale.value === "en" ? "en-US" : "pt-BR";
}
