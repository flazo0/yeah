import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { databases, services } from "@yeah/db";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

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

interface ParsedVersionTag {
  hasV: boolean;
  parts: number[];
  suffix: string;
}

/** "16-alpine" → {parts:[16], suffix:"-alpine"}. "v2.11" → {hasV:true, parts:[2,11], suffix:""}. */
function parseVersionTag(tag: string): ParsedVersionTag | null {
  const match = /^(v)?(\d+(?:\.\d+){0,3})(.*)$/.exec(tag);
  if (!match) return null;
  return { hasV: Boolean(match[1]), parts: match[2]!.split(".").map(Number), suffix: match[3] ?? "" };
}

function compareVersionParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
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

export const updateRoutes = new Elysia()
  .get("/updates/platform", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    return checkPlatformUpdate();
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

    const dbRows = await db.select({ image: databases.image }).from(databases).where(eq(databases.teamId, params.teamId));
    const svcRows = await db.select({ image: services.image }).from(services).where(eq(services.teamId, params.teamId));

    const allImages = [...dbRows.map((r) => r.image), ...svcRows.map((r) => r.image), ...KNOWN_SYSTEM_IMAGES].filter(
      (image, index, arr) => arr.indexOf(image) === index,
    );

    const images = await checkImageUpdates(allImages);
    return { images };
  });
