import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

/** `DB_POOL_MAX` as a positive integer, or undefined (= Bun's own default pool size). */
export function poolMaxFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function createDb(connectionString: string) {
  const max = poolMaxFromEnv(process.env.DB_POOL_MAX);
  // Unset keeps the exact previous behavior; it's only a knob for tuning on a real small VPS.
  return max === undefined ? drizzle(connectionString, { schema }) : drizzle({ connection: { url: connectionString, max }, schema });
}

export type Db = ReturnType<typeof createDb>;
