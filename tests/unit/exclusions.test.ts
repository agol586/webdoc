import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isExcludedPath, isExcludedTarget } from "../../src/lib/exclusions";

describe("project exclusions", () => {
  it("matches project-relative glob patterns", () => {
    expect(isExcludedPath(["**/*.draft.md"], join("guide", "start.draft.md"))).toBe(true);
    expect(isExcludedPath(["**/*.draft.md"], join("guide", "start.md"))).toBe(false);
  });

  it("matches directories with a trailing separator for subtree globs", () => {
    expect(
      isExcludedPath(["**/node_modules/**"], join("pkg", "node_modules"), { directory: true }),
    ).toBe(true);
  });

  it("treats an exact excluded directory as excluding its descendants", () => {
    expect(isExcludedPath(["private"], join("private", "secret.md"))).toBe(true);
  });

  it("matches case-sensitively", () => {
    expect(isExcludedPath(["PRIVATE"], join("private", "secret.md"))).toBe(false);
  });

  it("matches encoded logical paths and canonical targets", () => {
    const root = join(process.cwd(), "project");
    expect(
      isExcludedTarget(
        root,
        ["docs/space name.md"],
        "docs/space%20name.md",
        join(root, "docs", "space name.md"),
      ),
    ).toBe(true);
    expect(
      isExcludedTarget(
        root,
        ["private"],
        "alias.md",
        join(root, "private", "secret.md"),
      ),
    ).toBe(true);
  });
});
