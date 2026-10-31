import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { s3Storages, type S3Storage } from "@yeah/db";
import type { S3StorageDto } from "@yeah/shared";
import { s3ClientFor } from "@yeah/storage";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

function toStorageDto(storage: S3Storage): S3StorageDto {
  return {
    id: storage.id,
    teamId: storage.teamId,
    name: storage.name,
    endpoint: storage.endpoint,
    region: storage.region,
    bucket: storage.bucket,
    accessKeyId: storage.accessKeyId,
    createdAt: storage.createdAt.toISOString(),
  };
}

export const storageRoutes = new Elysia({ prefix: "/teams/:teamId/storages" })
  .get("/", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db.select().from(s3Storages).where(eq(s3Storages.teamId, params.teamId));
    return { storages: rows.map(toStorageDto) };
  })
  .post(
    "/",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }

      const [storage] = await db
        .insert(s3Storages)
        .values({
          teamId: params.teamId,
          name: body.name,
          endpoint: body.endpoint ?? null,
          region: body.region ?? "us-east-1",
          bucket: body.bucket,
          accessKeyId: body.accessKeyId,
          secretAccessKey: body.secretAccessKey,
        })
        .returning();
      if (!storage) {
        set.status = 500;
        return { error: "failed to create storage" };
      }

      return { storage: toStorageDto(storage) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        endpoint: t.Optional(t.String()),
        region: t.Optional(t.String()),
        bucket: t.String({ minLength: 1 }),
        accessKeyId: t.String({ minLength: 1 }),
        secretAccessKey: t.String({ minLength: 1 }),
      }),
    },
  )
  .post("/:storageId/test-connection", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db
      .select()
      .from(s3Storages)
      .where(and(eq(s3Storages.id, params.storageId), eq(s3Storages.teamId, params.teamId)))
      .limit(1);
    const storage = rows[0];
    if (!storage) {
      set.status = 404;
      return { error: "storage not found" };
    }

    // A small, bounded round-trip the browser is waiting on — same rationale as the SSH
    // "test-connection" route, except S3 calls are plain HTTPS so there's no worker hop needed.
    const markerKey = `.yeah-connection-test-${Date.now()}`;
    try {
      const client = s3ClientFor(storage);
      await client.write(markerKey, "ok");
      await client.delete(markerKey);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  })
  .delete("/:storageId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    await db.delete(s3Storages).where(and(eq(s3Storages.id, params.storageId), eq(s3Storages.teamId, params.teamId)));
    return { ok: true };
  });
