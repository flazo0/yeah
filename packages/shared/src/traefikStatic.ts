import { PROXY_NETWORK_NAME } from "./constants";
import { errorPageEntryPointYaml } from "./errorPage";

/**
 * The per-server Traefik static config (traefik.yml). Pure so the optional parts can be tested: traffic
 * analytics adds the loopback metrics entry point, the error page adds an entry-point middleware. With both
 * off the output is what every proxy has always had.
 */
export function traefikStaticConfig(acmeEmail: string, trafficAnalyticsEnabled: boolean, errorPageEnabled = false): string {
  return `entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
${errorPageEntryPointYaml(errorPageEnabled)}${trafficAnalyticsEnabled ? `  metrics:\n    address: ":8082"\n` : ""}
providers:
  docker:
    exposedByDefault: false
    network: ${PROXY_NETWORK_NAME}
  # Fase 6: routing of plain apps is written here (traefikDynamicConfig in packages/shared), so a
  # domain-only change updates routing without recreating the container. Empty until a deploy or a
  # domain edit writes into it. Without addRoutersLabels (metrics below) Traefik exports no per-router counters.
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${acmeEmail}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
${trafficAnalyticsEnabled ? `\nmetrics:\n  prometheus:\n    entryPoint: metrics\n    addRoutersLabels: true\n` : ""}`;
}
