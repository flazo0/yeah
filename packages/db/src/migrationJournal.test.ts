import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

// drizzle applies a migration only when its `when` is newer than the last one already applied, and skips the rest
// without any error. A migration generated on a machine whose clock is behind (or after a merge) would never run.
describe("migration journal", () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", dir), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };

  test("timestamps strictly increase with the index", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1]!;
      const cur = journal.entries[i]!;
      expect(cur.when, `${cur.tag} must be newer than ${prev.tag}`).toBeGreaterThan(prev.when);
    }
  });

  test("every SQL file is in the journal and the other way round", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, "")).sort();
    expect(journal.entries.map((e) => e.tag).sort()).toEqual(files);
  });
});
