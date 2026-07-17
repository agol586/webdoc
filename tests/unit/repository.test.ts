import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { ProjectConfig } from "../../src/config/load";
import { DocumentRepository, FileTooLargeError } from "../../src/repository/repository";
import type { TreeNode } from "../../src/repository/types";

function names(nodes: TreeNode[]): string[] {
  return nodes.map((node) => node.name);
}

describe("DocumentRepository", () => {
  let root: string;
  let project: ProjectConfig;
  let repository: DocumentRepository;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "webdoc-repository-"));
    project = { id: "docs", title: "Docs", root };
    repository = new DocumentRepository();
  });

  it("sorts directories first and entries naturally without case sensitivity", async () => {
    await Promise.all([
      mkdir(join(root, "Guide")),
      mkdir(join(root, "API")),
      writeFile(join(root, "page10.md"), "ten"),
      writeFile(join(root, "page2.md"), "two"),
    ]);

    expect(names(await repository.getTree(project))).toEqual(["API", "Guide", "page2.md", "page10.md"]);
  });

  it("classifies files and records their root-relative paths and sizes", async () => {
    await mkdir(join(root, "guide"));
    await writeFile(join(root, "guide", "intro.md"), "hello");
    await writeFile(join(root, "logo.PNG"), "png");
    await writeFile(join(root, "notes.txt"), "note");

    expect(await repository.getTree(project)).toEqual([
      {
        kind: "directory",
        name: "guide",
        path: "guide",
        children: [{ kind: "markdown", name: "intro.md", path: "guide/intro.md", size: 5 }],
      },
      { kind: "image", name: "logo.PNG", path: "logo.PNG", size: 3 },
      { kind: "attachment", name: "notes.txt", path: "notes.txt", size: 4 },
    ]);
  });

  it("omits escaping and broken symlinks and breaks directory cycles", async () => {
    const outside = await mkdtemp(join(tmpdir(), "webdoc-outside-"));
    await writeFile(join(outside, "secret.md"), "secret");
    await mkdir(join(root, "guide"));
    await writeFile(join(root, "guide", "intro.md"), "intro");
    await symlink(join(outside, "secret.md"), join(root, "escape.md"));
    await symlink(join(root, "missing.md"), join(root, "broken.md"));
    await symlink(root, join(root, "guide", "cycle"));

    const tree = await repository.getTree(project);
    expect(names(tree)).toEqual(["guide"]);
    expect(tree[0]).toMatchObject({ children: [{ name: "intro.md" }] });
  });

  it.each([
    [{ homepage: "start.md" }, "start.md"],
    [{}, "README.md"],
    [{}, "index.md"],
  ] as const)("chooses the documented homepage order", async (override, expected) => {
    await writeFile(join(root, expected), "home");
    expect(await repository.chooseHomepage({ ...project, ...override })).toBe(expected);
  });

  it("returns null when no homepage candidate exists", async () => {
    expect(await repository.chooseHomepage(project)).toBeNull();
  });

  it.each(["../outside.md", "/etc/passwd"])("rejects unsafe configured homepage %s", async (homepage) => {
    await expect(repository.chooseHomepage({ ...project, homepage })).rejects.toThrow(/path|absolute|outside/i);
  });

  it("requires a configured homepage to be a Markdown file", async () => {
    await writeFile(join(root, "start.txt"), "home");
    await expect(repository.chooseHomepage({ ...project, homepage: "start.txt" })).rejects.toThrow(/markdown/i);
  });

  it("rejects content larger than the supplied limit before buffering", async () => {
    await writeFile(join(root, "large.md"), "123456789");
    await expect(repository.read(project, "large.md", 8)).rejects.toThrow(FileTooLargeError);
  });

  it("reads a file through the canonical path policy", async () => {
    await writeFile(join(root, "guide.md"), "guide");
    expect(await repository.read(project, "guide.md", 8)).toEqual(Buffer.from("guide"));
    await expect(repository.read(project, "../secret.md", 8)).rejects.toThrow(/outside/i);
  });
});
