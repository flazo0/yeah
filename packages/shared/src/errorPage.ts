import { WAKER_CONTAINER_NAME, WAKER_PORT } from "./constants";

// Proxy-wide custom error page. Optional per server: when enabled, Traefik sends unknown hosts (404, a catch-all
// router with the lowest priority) and unreachable backends (502-504, an errors middleware on the HTTPS entry point)
// to the server's waker, which renders a generic page (apps/worker/src/lib/waker.cjs). Everything here is pure;
// the HTML itself is rendered and escaped by the waker, which has no dependencies.

export const ERROR_PAGE_TITLE_MAX = 120;
export const ERROR_PAGE_MESSAGE_MAX = 500;

export interface ErrorPageSettings {
  enabled: boolean;
  /** null = the generic per-status title. */
  title: string | null;
  /** null = the generic per-status message. */
  message: string | null;
}

/** Trims, drops control characters, caps the length; "" and non-strings become null. Escaping happens at render time. */
export function normalizeErrorPageText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = input.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max).trim();
  return clean === "" ? null : clean;
}

/** Name of the middleware the HTTPS entry point applies (defined in the file provider). */
export const ERROR_PAGE_MIDDLEWARE = "yeah-errors";
export const ERROR_PAGE_DYNAMIC_FILE = "yeah-error-page.yml";
/** Waker config directory file (not `.json`, so it is never mistaken for an app entry). */
export const ERROR_PAGE_WAKER_FILE = "errorpage.conf";

/** The waker's `errorpage.conf`. */
export function errorPageConfigJson(settings: Pick<ErrorPageSettings, "title" | "message">): string {
  return `${JSON.stringify({ title: settings.title ?? "", message: settings.message ?? "" }, null, 2)}\n`;
}

/** Static Traefik config fragment: the entry-point middleware. Empty when the feature is off, so existing proxies are unchanged. */
export function errorPageEntryPointYaml(enabled: boolean): string {
  return enabled ? `    http:\n      middlewares:\n        - ${ERROR_PAGE_MIDDLEWARE}@file\n` : "";
}

/** Dynamic (File Provider) config: errors middleware for 502-504, the waker as its service and a lowest-priority catch-all router. */
export function errorPageDynamicConfig(): string {
  const backend = `http://${WAKER_CONTAINER_NAME}:${WAKER_PORT}`;
  return [
    "http:",
    "  routers:",
    "    yeah-error-page-catchall:",
    '      rule: "HostRegexp(`{host:.+}`)"',
    "      entryPoints:",
    "        - websecure",
    "      tls: {}",
    "      service: yeah-error-pages",
    "      priority: 1",
    "  middlewares:",
    `    ${ERROR_PAGE_MIDDLEWARE}:`,
    "      errors:",
    "        status:",
    '          - "502-504"',
    "        service: yeah-error-pages",
    '        query: "/__error/{status}"',
    "  services:",
    "    yeah-error-pages:",
    "      loadBalancer:",
    "        servers:",
    `          - url: "${backend}"`,
    "",
  ].join("\n");
}
