import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    {
      // CSP treats ws:// as a different scheme from http://, so the API's WebSocket origin has to be listed too.
      name: "csp-api-ws",
      transformIndexHtml: {
        order: "pre",
        handler: (html: string) => html.replace("__API_WS_URL__", (process.env.VITE_API_URL ?? "").replace(/^http/, "ws")),
      },
    },
  ],
  // Empty/unset (local dev) = "/". In production this is the random per-install panel path
  // (see install.sh) — baked in at build time so asset URLs, the router and the api/ws relative
  // paths (lib/api.ts, lib/ws.ts, all reading import.meta.env.BASE_URL) agree on one prefix.
  // Vite requires a trailing slash on `base` — normalized here so install.sh doesn't have to care.
  base: `${process.env.VITE_BASE_PATH || "/"}`.replace(/\/*$/, "/"),
  server: {
    port: 5173,
  },
});
