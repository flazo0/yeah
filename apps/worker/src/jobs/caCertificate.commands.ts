import { shellQuote } from "@yeah/shared";

// Pure command builders for trusting a registry's CA certificate — kept separate so they can be
// unit tested without loading ssh2 (same split as the other jobs).

export function caCertDir(host: string): string {
  return `/etc/docker/certs.d/${host}`;
}

/** Writes the PEM as ca.crt in Docker's per-registry certs directory; no daemon restart needed. */
export function buildInstallCaCertCommand(host: string): string {
  return `mkdir -p ${shellQuote(caCertDir(host))}`;
}

/** Removes the whole per-registry directory — safe even if nothing else was ever written there. */
export function buildRemoveCaCertCommand(host: string): string {
  return `rm -rf ${shellQuote(caCertDir(host))}`;
}
