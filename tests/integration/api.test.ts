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
  fixture = await mkdtemp(join(tmpdir(), "docshare-api-"));
  fixtures.push(fixture);
  projectRoot = join(fixture, "alpha");
  await mkdir(projectRoot);
  await writeFile(join(projectRoot, "README.md"), "# Alpha\n");
  await writeFile(join(projectRoot, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(projectRoot, "archive.bin"), "binary");
  await writeFile(join(projectRoot, "hidden.excluded.md"), "# Hidden\n");
  await mkdir(join(projectRoot, "private"));
  await writeFile(join(projectRoot, "private", "asset.bin"), "private");
  await writeFile(
    join(fixture, "docshare.config.yaml"),
    "limits:\n  markdownBytes: 16\n  assetBytes: 64\nprojects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n    exclude:\n      - '**/*.excluded.md'\n      - private\n",
  );
  process.env.DOCSHARE_CONFIG = join(fixture, "docshare.config.yaml");
});

afterEach(async () => {
  delete process.env.DOCSHARE_CONFIG;
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

  it("omits excluded files and directories from the project tree", async () => {
    const response = await (await routes()).tree(new Request("http://localhost"), context("alpha"));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(body).not.toContain("hidden.excluded.md");
    expect(body).not.toContain("private");
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

  it("forbids direct access to excluded Markdown", async () => {
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", ["hidden.excluded.md"]),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
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

  it("forbids direct access to assets below an excluded directory", async () => {
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", ["private", "asset.bin"]),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });

  it("uses an ASCII fallback and RFC 5987 filename for Unicode attachments", async () => {
    await writeFile(join(projectRoot, "中文.bin"), "data");
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", ["中文.bin"]),
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename=".bin"; filename*=UTF-8''${encodeURIComponent("中文.bin")}`,
    );
  });

  it("removes unsafe ASCII controls, quotes, backslashes, and DEL from attachment fallback", async () => {
    const filename = `a\u0001\"b\\c\u007f.bin`;
    await writeFile(join(projectRoot, filename), "data");
    const response = await (await routes()).assets(
      new Request("http://localhost"),
      context("alpha", [filename]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="abc.bin"');
  });

  it("does not open an asset when header construction fails", async () => {
    const { DocumentRepository } = await import("../../src/repository/repository");
    const stream = vi.spyOn(DocumentRepository.prototype, "stream");
    const NativeHeaders = globalThis.Headers;
    vi.stubGlobal("Headers", class extends NativeHeaders {
      constructor() {
        super();
        throw new TypeError("header failure");
      }
    });
    try {
      const response = await (await routes()).assets(
        new Request("http://localhost"),
        context("alpha", ["archive.bin"]),
      );
      expect(response.status).toBe(500);
      expect(stream).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes an opened asset when response construction fails", async () => {
    const { DocumentRepository } = await import("../../src/repository/repository");
    const close = vi.fn();
    vi.spyOn(DocumentRepository.prototype, "stream").mockResolvedValue({
      body: new ReadableStream<Uint8Array>(),
      size: 1,
      mtimeMs: 1,
      close,
    });
    const NativeResponse = globalThis.Response;
    vi.stubGlobal("Response", class extends NativeResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        if (body instanceof ReadableStream) throw new TypeError("response failure");
        super(body, init);
      }

      static json(data: unknown, init?: ResponseInit): Response {
        return NativeResponse.json(data, init);
      }
    });
    try {
      const response = await (await routes()).assets(
        new Request("http://localhost"),
        context("alpha", ["archive.bin"]),
      );
      expect(response.status).toBe(500);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["percent%.md", "literal%2F.md"])("serves decoded literal filename %s", async (filename) => {
    await writeFile(join(projectRoot, filename), `# ${filename}`);
    const response = await (await routes()).content(
      new Request("http://localhost"),
      context("alpha", [filename]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ path: filename });
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
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Invalid path" });
    expect(body).not.toContain(fixture);
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

  it("retries server context initialization after a rejected config load", async () => {
    const configPath = join(fixture, "docshare.config.yaml");
    await writeFile(configPath, "projects: []\n");
    const { projects } = await routes();
    expect((await projects()).status).toBe(500);
    await writeFile(
      configPath,
      "projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n",
    );
    const response = await projects();
    expect(response.status).toBe(200);
  });
});
