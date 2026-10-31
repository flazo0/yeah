import { integer, real } from "drizzle-orm/pg-core";

/**
 * Shared by Application/Database/Service — `docker run --memory=<mb>m --cpus=<cpu>` when set,
 * omitted (unlimited, original behavior) when null. Spread into each table's column object
 * instead of duplicating the same two columns three times.
 */
export function resourceLimitColumns() {
  return {
    memoryLimitMb: integer("memory_limit_mb"),
    cpuLimit: real("cpu_limit"),
  };
}
