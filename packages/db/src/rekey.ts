import { createDb } from "./client";
import { reencryptSecrets } from "./encryptExisting";

// bun run --cwd packages/db db:rekey — after moving the old ENCRYPTION_KEY to ENCRYPTION_KEY_PREVIOUS.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { rewritten, failed } = await reencryptSecrets(createDb(url));
console.log(`secrets rewritten with the current key: ${rewritten}`);
for (const f of failed) console.error(`could not re-encrypt: ${f}`);
process.exit(failed.length ? 1 : 0);
