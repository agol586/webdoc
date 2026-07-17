import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RouteContext = { params: Promise<{ projectId: string; path: string[] }> };

const fixtures: string[] = [];
let fixture: string;
let projectRoot: string;

function context(projectId: string, path?: string[]): RouteContext {
  return { params: Promise.resolve({ projectId, path: path ?? [] }) };
}

async function routes() {
  const [{ GET: projects }, { GET: tree }, { GET: content }, { GET: assets }] = await Promise.all([
    import("../../src/app/api/projects/route"),
    import("../../src/app/api/tree/[projectId]/route"),
    import("../../src/app/api/content/[projectId]/[...path]/route"),
    import("../../src/app/api/assets/[projectId]/[...path]/route"),
  ]);
  return { projects, tree, content, assets };
}

beforeEach(async () => {
  vi.resetModules();
  fixture = await mkdtemp(join(tmpdir(), "webdoc-api-"));
  fixtures.push(fixture);
  projectRoot = join(fixture, "alpha");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "README.md"), "# Alpha\n");
  await writeFile(join(projectRoot, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(projectRoot, "archive.bin"), "binary");
  await writeFile(
    join(fixture, "webdoc.config.yaml"),
    "limits:\n  markdownBytes: 16\n  assetBytes: 64\nprojects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n",
  );
  process.env.WEBDOC_CONFIG = join(fixture, "webdoc.config.yaml");
});

afterEach(async () => {
  delete process.env.WEBDOC_CONFIG;
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("document APIs", () => {
  it("lists projects without exposing filesystem roots", async () => {
    const response = await (await routes()).projects();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      projects: [{ id: "alpha", title: "Alpha", available: true }],
    });
    expect(body).not.toContain(fixture);
  });

  it("returns a project tree", async () => {
    const response = await (await routes()).tree(new Request("http://localhost"), context("alpha"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      project: { id: "alpha", title: "Alpha" },
      tree: expect.arrayContaining([expect.objectContaining({ path: "README.md", kind: "markdown" })]),
    });
  });

  it("returns rendered document HTML", async () => {
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", ["README.md"]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      path: "README.md",
      html: expect.stringContaining("<h1"),
      title: "Alpha",
    });
  });

  it("serves SVG as an image with hardened headers", async () => {
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", ["diagram.svg"]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(await response.text()).toContain("<svg");
  });

  it("forces unknown attachment types to download with a safe filename", async () => {
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", ["archive.bin"]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="archive.bin"');
  });

  it("returns 404 for an unknown project", async () => {
    const response = await (await routes()).tree(new Request("http://localhost"), context("missing"));
    expect(response.status).toBe(404);
  });

  it("returns 400 for traversal without exposing paths", async () => {
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", ["..", "secret.md"]),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(fixture);
  });

  it("returns 404 for a missing file", async () => {
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", ["missing.md"]),
    );
    expect(response.status).toBe(404);
  });

  it("returns 403 for an unreadable file", async () => {
    await writeFile(join(projectRoot, "private.md"), "private");
    await chmod(join(projectRoot, "private.md"), 0o000);
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", ["private.md"]),
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 before streaming an unreadable asset", async () => {
    await chmod(join(projectRoot, "diagram.svg"), 0o000);
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", ["diagram.svg"]),
    );
    expect(response.status).toBe(403);
  });

  it("returns 413 for an oversized Markdown file", async () => {
    await writeFile(join(projectRoot, "large.md"), "# This document is too large");
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", ["large.md"]),
    );
    expect(response.status).toBe(413);
  });

  it("returns 413 for an oversized asset", async () => {
    await writeFile(join(projectRoot, "large.png"), Buffer.alloc(65));
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", ["large.png"]),
    );
    expect(response.status).toBe(413);
  });

  it("returns 503 when a configured project becomes unavailable", async () => {
    const { projects, tree } = await routes();
    expect((await projects()).status).toBe(200);
    await rm(projectRoot, { recursive: true });
    const response = await tree(new Request("http://localhost"), context("alpha"));
    expect(response.status).toBe(503);
  });
});
