import { Elysia, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { databases, platformOperations, services, type PlatformOperation } from "@yeah/db";
import type { ImageUpdateResourceDto, PlatformOperationDto, SystemImageUpdateDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { platformOperationQueue, databaseProvisionQueue, serviceProvisionQueue } from "../lib/queue";
import { compareVersionParts, parseVersionTag, type ParsedVersionTag } from "./updates.pure";

export { compareVersionParts, parseVersionTag } from "./updates.pure";

const GITHUB_REPO = "flazo0/yeah";
const KNOWN_SYSTEM_IMAGES = ["traefik:v2.11"];

interface PlatformUpdateInfo {
  currentCommit: string | null;
  latestCommit: string | null;
  updateAvailable: boolean | null;
  compareUrl: string | null;
}

async function checkPlatformUpdate(): Promise<PlatformUpdateInfo> {
  const currentCommit = process.env.YEAH_COMMIT && process.env.YEAH_COMMIT !== "dev" ? process.env.YEAH_COMMIT : null;
  if (!currentCommit) {
    // Local dev (bun run dev, no docker build) has no baked-in commit — nothing to compare.
    return { currentCommit: null, latestCommit: null, updateAvailable: null, compareUrl: null };
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { currentCommit, latestCommit: null, updateAvailable: null, compareUrl: null };
    const body = (await res.json()) as { sha: string };
    return {
      currentCommit,
      latestCommit: body.sha,
      updateAvailable: body.sha !== currentCommit,
      compareUrl: `https://github.com/${GITHUB_REPO}/compare/${currentCommit}...main`,
    };
  } catch {
    return { currentCommit, latestCommit: null, updateAvailable: null, compareUrl: null };
  }
}

interface ImageUpdateInfo {
  image: string;
  currentTag: string;
  latestTag: string | null;
  updateAvailable: boolean | null;
}

/**
 * Docker Hub only — `quay.io` images (like MinIO) can't be checked through this API, reported
 * as "unknown". Sorting by `last_updated` alone (the naive approach) surfaces whatever tag was
 * *pushed* most recently — often a platform variant like "windowsservercore-ltsc2025" rather
 * than the newest version of the tag scheme actually in use — so results are filtered down to
 * tags that share the current tag's exact shape (same "v" prefix, same non-numeric suffix)
 * before comparing version numbers.
 */
async function latestDockerHubTag(repository: string, currentTag: string): Promise<string | null> {
  const current = parseVersionTag(currentTag);
  if (!current) return null;

  try {
    const res = await fetch(`https://hub.docker.com/v2/repositories/${repository}/tags?page_size=100&ordering=last_updated`);
    if (!res.ok) return null;
    const body = (await res.json()) as { results: { name: string }[] };

    let best: { name: string; parsed: ParsedVersionTag } | null = null;
    for (const { name } of body.results) {
      const parsed = parseVersionTag(name);
      if (!parsed || parsed.hasV !== current.hasV || parsed.suffix !== current.suffix) continue;
      if (!best || compareVersionParts(parsed.parts, best.parsed.parts) > 0) best = { name, parsed };
    }
    if (!best) return null;
    return compareVersionParts(best.parsed.parts, current.parts) > 0 ? best.name : currentTag;
  } catch {
    return null;
  }
}

async function checkImageUpdates(images: string[]): Promise<ImageUpdateInfo[]> {
  const unique = [...new Set(images)];
  return Promise.all(
    unique.map(async (image): Promise<ImageUpdateInfo> => {
      const [repo, tag = "latest"] = image.split(":");
      if (image.startsWith("quay.io/")) {
        return { image, currentTag: tag, latestTag: null, updateAvailable: null };
      }
      const repository = repo && !repo.includes("/") ? `library/${repo}` : (repo ?? "");
      const latestTag = await latestDockerHubTag(repository, tag);
      return { image, currentTag: tag, latestTag, updateAvailable: latestTag ? latestTag !== tag : null };
    }),
  );
}

function toPlatformOperationDto(op: PlatformOperation): PlatformOperationDto {
  return {
    id: op.id,
    kind: op.kind,
    status: op.status,
    log: op.log,
    startedAt: op.startedAt ? op.startedAt.toISOString() : null,
    finishedAt: op.finishedAt ? op.finishedAt.toISOString() : null,
    createdAt: op.createdAt.toISOString(),
  };
}

async function startPlatformOperation(kind: "platform_update" | "system_update"): Promise<PlatformOperationDto | null> {
  // One at a time, whichever kind — both touch the same host, running two at once would race.
  const inFlight = await db
    .select()
    .from(platformOperations)
    .where(eq(platformOperations.status, "running"))
    .limit(1);
  if (inFlight[0]) return null;

  const [operation] = await db.insert(platformOperations).values({ kind, status: "queued" }).returning();
  if (!operation) return null;
  await platformOperationQueue.add("platform-operation", { operationId: operation.id });
  return toPlatformOperationDto(operation);
}

export const updateRoutes = new Elysia()
  .get("/updates/platform", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    return checkPlatformUpdate();
  })
  .post("/updates/platform/run", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const operation = await startPlatformOperation("platform_update");
    if (!operation) {
      set.status = 409;
      return { error: "já tem uma atualização rodando" };
    }
    return { operation };
  })
  .post("/updates/system/run", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const operation = await startPlatformOperation("system_update");
    if (!operation) {
      set.status = 409;
      return { error: "já tem uma atualização rodando" };
    }
    return { operation };
  })
  .get("/updates/operations", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const [platformRows, systemRows] = await Promise.all([
      db.select().from(platformOperations).where(eq(platformOperations.kind, "platform_update")).orderBy(desc(platformOperations.createdAt)).limit(1),
      db.select().from(platformOperations).where(eq(platformOperations.kind, "system_update")).orderBy(desc(platformOperations.createdAt)).limit(1),
    ]);
    return {
      platformUpdate: platformRows[0] ? toPlatformOperationDto(platformRows[0]) : null,
      systemUpdate: systemRows[0] ? toPlatformOperationDto(systemRows[0]) : null,
    };
  })
  .get("/teams/:teamId/updates/images", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const dbRows = await db
      .select({ id: databases.id, name: databases.name, image: databases.image })
      .from(databases)
      .where(eq(databases.teamId, params.teamId));
    const svcRows = await db
      .select({ id: services.id, name: services.name, image: services.image })
      .from(services)
      .where(eq(services.teamId, params.teamId));

    const allImages = [...dbRows.map((r) => r.image), ...svcRows.map((r) => r.image), ...KNOWN_SYSTEM_IMAGES].filter(
      (image, index, arr) => arr.indexOf(image) === index,
    );
    const checked = await checkImageUpdates(allImages);
    const byImage = new Map(checked.map((c) => [c.image, c]));

    const images: ImageUpdateResourceDto[] = [
      ...dbRows.map((r) => {
        const info = byImage.get(r.image)!;
        return { resourceType: "database" as const, resourceId: r.id, resourceName: r.name, image: r.image, currentTag: info.currentTag, latestTag: info.latestTag, updateAvailable: info.updateAvailable };
      }),
      ...svcRows.map((r) => {
        const info = byImage.get(r.image)!;
        return { resourceType: "service" as const, resourceId: r.id, resourceName: r.name, image: r.image, currentTag: info.currentTag, latestTag: info.latestTag, updateAvailable: info.updateAvailable };
      }),
    ];
    const system: SystemImageUpdateDto[] = KNOWN_SYSTEM_IMAGES.map((image) => {
      const info = byImage.get(image)!;
      return { image, currentTag: info.currentTag, latestTag: info.latestTag, updateAvailable: info.updateAvailable };
    });

    return { images, system };
  })
  .post(
    "/teams/:teamId/updates/images/apply",
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

      if (body.resourceType === "database") {
        const rows = await db.select().from(databases).where(eq(databases.id, body.resourceId)).limit(1);
        const database = rows[0];
        if (!database || database.teamId !== params.teamId) {
          set.status = 404;
          return { error: "database not found" };
        }
        const [repo] = database.image.split(":");
        const latest = await latestDockerHubTag(repo && !repo.includes("/") ? `library/${repo}` : (repo ?? ""), database.image.split(":")[1] ?? "latest");
        if (!latest) {
          set.status = 400;
          return { error: "não foi possível checar a tag mais recente" };
        }
        await db.update(databases).set({ image: `${repo}:${latest}`, status: "provisioning" }).where(eq(databases.id, database.id));
        await databaseProvisionQueue.add("provision", { databaseId: database.id });
        return { ok: true };
      }

      const rows = await db.select().from(services).where(eq(services.id, body.resourceId)).limit(1);
      const service = rows[0];
      if (!service || service.teamId !== params.teamId) {
        set.status = 404;
        return { error: "service not found" };
      }
      const [repo] = service.image.split(":");
      const latest = await latestDockerHubTag(repo && !repo.includes("/") ? `library/${repo}` : (repo ?? ""), service.image.split(":")[1] ?? "latest");
      if (!latest) {
        set.status = 400;
        return { error: "não foi possível checar a tag mais recente" };
      }
      await db.update(services).set({ image: `${repo}:${latest}`, status: "provisioning" }).where(eq(services.id, service.id));
      await serviceProvisionQueue.add("provision", { serviceId: service.id });
      return { ok: true };
    },
    { body: t.Object({ resourceType: t.Union([t.Literal("database"), t.Literal("service")]), resourceId: t.String({ minLength: 1 }) }) },
  );
