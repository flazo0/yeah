import { resourceSlug } from "./shell";
import type { DatabaseEngine } from "./types";

// How clients reach a database: the internal hostname other resources of the same environment use
// (a docker network alias), and the connection URLs built from it or from the server's address.

/** Every resource of an environment joins this docker network, so they resolve each other by name. */
export function environmentNetworkName(environmentId: string): string {
  return `yeah-env-${environmentId}`;
}

/** `docker network inspect` first so an existing network (and its attached containers) is never touched. */
export function ensureNetworkCommand(network: string): string {
  return `docker network inspect '${network}' >/dev/null 2>&1 || docker network create '${network}' >/dev/null`;
}

/** The name other containers of the environment use to reach this resource. */
export function internalHostName(resourceName: string): string {
  return resourceSlug(resourceName) || "resource";
}

export interface ConnectionParams {
  engine: DatabaseEngine;
  host: string;
  port: number;
  username: string | null;
  password: string;
  databaseName: string | null;
  ssl: boolean;
}

const enc = encodeURIComponent;

/** A ready-to-paste URL for the engine's usual client library (the password is percent-encoded). */
export function databaseConnectionUrl(c: ConnectionParams): string {
  const user = c.username ? enc(c.username) : "";
  // The redis family has no login user, but "default" is the ACL user every client accepts (an empty one makes redis-cli send AUTH "" and fail).
  const auth = c.username ? `${user}:${enc(c.password)}` : `default:${enc(c.password)}`;
  const hostport = `${c.host}:${c.port}`;
  switch (c.engine) {
    case "postgresql":
      return `postgresql://${auth}@${hostport}/${enc(c.databaseName ?? "postgres")}${c.ssl ? "?sslmode=require" : ""}`;
    case "mysql":
    case "mariadb":
      return `mysql://${auth}@${hostport}/${enc(c.databaseName ?? "")}${c.ssl ? "?ssl-mode=REQUIRED" : ""}`;
    case "mongodb":
      return `mongodb://${auth}@${hostport}/${enc(c.databaseName ?? "")}?authSource=admin${c.ssl ? "&tls=true&tlsAllowInvalidCertificates=true" : ""}`;
    case "redis":
    case "keydb":
    case "dragonfly":
      return `${c.ssl ? "rediss" : "redis"}://${auth}@${hostport}`;
    case "clickhouse":
      return `${c.ssl ? "https" : "http"}://${auth}@${hostport}/?database=${enc(c.databaseName ?? "default")}`;
  }
}
