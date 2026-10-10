#!/usr/bin/env bun
import { CliError } from "./client";
import { run } from "./run";

try {
  console.log(await run(process.argv.slice(2), process.env, fetch));
} catch (err) {
  console.error(err instanceof CliError ? err.message : `erro inesperado: ${(err as Error).message}`);
  process.exit(1);
}
