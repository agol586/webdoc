import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PathPolicyError, resolveInsideRoot } from "../../src/lib/path-policy";

describe("resolveInsideRoot", () => {
  it.each(["../secret", "%2e%2e/secret", "/etc/passwd", "C:\\Windows\\win.ini"])(
    "rejects %s",
    async (requested) => {
      const root = await mkdtemp(join(tmpdir(), "docshare-root-"));
      await expect(resolveInsideRoot(root, requested)).rejects.toThrow(PathPolicyError);
    },
  );

  it("rejects a symlink whose canonical target escapes the root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "docshare-policy-"));
    const root = join(parent, "root");
    const outsideFile = join(parent, "secret.md");
    await mkdir(root);
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, join(root, "escape.md"));

    await expect(resolveInsideRoot(root, "escape.md")).rejects.toThrow(/outside/i);
  });

  it("allows an internal symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "docshare-root-"));
    const guide = join(root, "guide.md");
    await writeFile(guide, "guide");
    await symlink(guide, join(root, "alias.md"));

    expect(await resolveInsideRoot(root, "alias.md")).toBe(await realpath(guide));
  });

  it("decodes exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "docshare-root-"));
    const literal = join(root, "%2e%2e");
    await mkdir(literal);
    await writeFile(join(literal, "guide.md"), "guide");

    expect(await resolveInsideRoot(root, "%252e%252e/guide.md")).toBe(join(literal, "guide.md"));
  });

  it("allows a contained filename that starts with two dots", async () => {
    const root = await mkdtemp(join(tmpdir(), "docshare-root-"));
    const file = join(root, "..notes.md");
    await writeFile(file, "notes");

    expect(await resolveInsideRoot(root, "..notes.md")).toBe(file);
  });
});
