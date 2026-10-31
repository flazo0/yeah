// Preloaded before every test file (see bunfig.toml). Several modules construct a Postgres/Redis
// client at import time and throw if these env vars are missing — both clients are lazy (they
// don't actually connect until a query runs), so a fake-but-well-formed value is enough to let
// unit tests import that code without a real database or Redis running.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:1";
process.env.SESSION_SECRET ??= "test-session-secret";
