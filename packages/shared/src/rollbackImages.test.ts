import { describe, expect, test } from "bun:test";
import {
  appImagesCommand,
  deploymentImageRef,
  deploymentImageTag,
  deploymentsToRetain,
  matchImagesToDeployments,
  parseAppImages,
  removeRefsCommand,
  selectImagesToRemove,
  staleDeploymentRefs,
  tagDeploymentImageCommand,
  validateRollbackImages,
} from "./rollbackImages";
import { parseDockerImages } from "./serverOps";

const APP = "11111111-2222-3333-4444-555555555555";
const D1 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const D2 = "99999999-bbbb-cccc-dddd-eeeeeeeeeeee";
const D3 = "77777777-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("tags and commands", () => {
  test("deployment tag and ref", () => {
    expect(deploymentImageTag(D1)).toBe("dep-aaaaaaaabbbb");
    expect(deploymentImageRef(APP, D1)).toBe(`yeah-app-${APP}:dep-aaaaaaaabbbb`);
  });
  test("tag command is quoted", () => {
    expect(tagDeploymentImageCommand(APP, D1)).toBe(`docker tag 'yeah-app-${APP}' 'yeah-app-${APP}:dep-aaaaaaaabbbb'`);
  });
  test("list command filters by reference", () => {
    expect(appImagesCommand(APP)).toContain(`reference=yeah-app-${APP}`);
  });
  test("validates the retention count", () => {
    expect(validateRollbackImages(0)).toBeNull();
    expect(validateRollbackImages(5)).toBeNull();
    expect(validateRollbackImages(21)).not.toBeNull();
    expect(validateRollbackImages(-1)).not.toBeNull();
    expect(validateRollbackImages(1.5)).not.toBeNull();
    expect(validateRollbackImages("3")).not.toBeNull();
  });
  test("removeRefsCommand", () => {
    expect(removeRefsCommand([])).toBeNull();
    expect(removeRefsCommand(["a:b", "c:d"])).toBe("docker image rm 'a:b' 'c:d' >/dev/null 2>&1 || true");
  });
});

const out = [
  `IMG|sha256:${"a".repeat(64)}|yeah-app-${APP}|latest|120MB|1 hour ago`,
  `IMG|sha256:${"a".repeat(64)}|yeah-app-${APP}|dep-aaaaaaaabbbb|120MB|1 hour ago`,
  `IMG|sha256:${"b".repeat(64)}|yeah-app-${APP}|dep-99999999bbbb|118MB|2 days ago`,
  `IMG|sha256:${"c".repeat(64)}|yeah-app-${APP}|dep-deadbeefdead|110MB|3 days ago`,
  `RUN|sha256:${"a".repeat(64)}`,
  "",
].join("\n");

describe("parse and match", () => {
  const images = parseAppImages(out, APP);
  test("parses tags, deployment tags and the running image", () => {
    expect(images).toHaveLength(4);
    expect(images[0]).toMatchObject({ tag: "latest", deploymentTag: null, running: true });
    expect(images[1]).toMatchObject({ deploymentTag: "dep-aaaaaaaabbbb", running: true, id: "a".repeat(12) });
    expect(images[2]).toMatchObject({ running: false, size: "118MB" });
  });
  test("ignores other repositories", () => {
    expect(parseAppImages(`IMG|sha256:${"d".repeat(64)}|nginx|alpine|5MB|1 day ago`, APP)).toEqual([]);
  });
  const deployments = [
    { id: D1, status: "success", commitSha: "abc1234", createdAt: "2026-10-31T10:00:00Z" },
    { id: D2, status: "success", commitSha: "def5678", createdAt: "2026-10-29T10:00:00Z" },
    { id: D3, status: "failed", commitSha: null, createdAt: "2026-10-30T10:00:00Z" },
  ];
  test("matches images to deployments, newest first, hides the run name when tagged", () => {
    const entries = matchImagesToDeployments(images, deployments);
    expect(entries.map((e) => e.deploymentId)).toEqual([D1, D2, null]);
    expect(entries[0]).toMatchObject({ commitSha: "abc1234", running: true });
    expect(entries[2]!.deploymentTag).toBe("dep-deadbeefdead");
  });
  test("keeps the run name when nothing else tags the image", () => {
    const only = parseAppImages(`IMG|sha256:${"e".repeat(64)}|yeah-app-${APP}|latest|1MB|now\nRUN|sha256:${"e".repeat(64)}`, APP);
    expect(matchImagesToDeployments(only, [])).toHaveLength(1);
  });
  test("retains the newest successful deployments only", () => {
    expect(deploymentsToRetain(deployments, 1).map((d) => d.id)).toEqual([D1]);
    expect(deploymentsToRetain(deployments, 5).map((d) => d.id)).toEqual([D1, D2]);
    expect(deploymentsToRetain(deployments, 0)).toEqual([]);
  });
  test("stale refs are deployment tags outside the retained set", () => {
    const stale = staleDeploymentRefs(images, deploymentsToRetain(deployments, 1));
    expect(stale).toEqual([`yeah-app-${APP}:dep-99999999bbbb`, `yeah-app-${APP}:dep-deadbeefdead`]);
  });
});

describe("selectImagesToRemove", () => {
  const listing = [
    "IMG|sha256:aaaaaaaaaaaa1111|nginx|alpine|5MB|1 day ago",
    "IMG|sha256:bbbbbbbbbbbb2222|yeah-app-x|dep-111111111111|5MB|1 day ago",
    "IMG|sha256:bbbbbbbbbbbb2222|yeah-app-x|latest|5MB|1 day ago",
    "IMG|sha256:cccccccccccc3333|<none>|<none>|5MB|1 day ago",
    "IMG|sha256:dddddddddddd4444|yeah-app-x|dep-222222222222|5MB|1 day ago",
    "USED|sha256:dddddddddddd4444",
  ].join("\n");
  test("removes unused unprotected images, keeps protected and in-use ones", () => {
    const ids = selectImagesToRemove(parseDockerImages(listing), new Set(["yeah-app-x:dep-111111111111"]));
    expect(ids.sort()).toEqual(["aaaaaaaaaaaa", "cccccccccccc"]);
  });
  test("a protected tag protects the whole image even via another tag", () => {
    const ids = selectImagesToRemove(parseDockerImages(listing), new Set(["yeah-app-x:latest"]));
    expect(ids).not.toContain("bbbbbbbbbbbb");
  });
});
