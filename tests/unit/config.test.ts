import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/load";

const fixtureDirectories: string[] = [];

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "webdoc-config-"));
  fixtureDirectories.push(directory);
  await mkdir(join(directory, "alpha"));
  return directory;
}

async function loadFixtureConfig(source: string) {
  const directory = await createFixture();
  const configPath = join(directory, "webdoc.config.yaml");
  await writeFile(configPath, source, "utf8");
  return { config: await loadConfig(configPath), directory };
}

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("loadConfig", () => {
  it("canonicalizes project roots and applies defaults", async () => {
    const { config, directory } = await loadFixtureConfig(
      "projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n",
    );

    expect(config.server).toEqual({ host: "127.0.0.1", port: 3030 });
    expect(config.limits).toEqual({
      markdownBytes: 5 * 1024 * 1024,
      assetBytes: 25 * 1024 * 1024,
    });
    expect(config.projects[0].root).toBe(await realpath(join(directory, "alpha")));
  });

  it.each(["../bad", "has space", ""])('rejects project id %j', async (id) => {
    await expect(
      loadFixtureConfig(
        `projects:\n  - id: ${JSON.stringify(id)}\n    title: Bad\n    path: ./alpha\n`,
      ),
    ).rejects.toThrow(/project.*id/i);
  });

  it("rejects duplicate project ids", async () => {
    await expect(
      loadFixtureConfig(
        "projects:\n  - id: alpha\n    title: First\n    path: ./alpha\n  - id: alpha\n    title: Second\n    path: ./alpha\n",
      ),
    ).rejects.toThrow(/unique/i);
  });

  it("accepts configured server, limits, and homepage values", async () => {
    const directory = await createFixture();
    await mkdir(join(directory, "alpha", "guide"));
    await writeFile(join(directory, "alpha", "guide", "start.md"), "home");
    const configPath = join(directory, "webdoc.config.yaml");
    await writeFile(configPath,
      "server:\n  host: 0.0.0.0\n  port: 8080\nlimits:\n  markdownBytes: 100\n  assetBytes: 200\nprojects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n    homepage: guide/start.md\n",
    );
    const config = await loadConfig(configPath);

    expect(config.server).toEqual({ host: "0.0.0.0", port: 8080 });
    expect(config.limits).toEqual({ markdownBytes: 100, assetBytes: 200 });
    expect(config.projects[0].homepage).toBe("guide/start.md");
  });

  it.each(["../outside.md", "missing.md", "folder.md", "notes.txt"])("rejects invalid explicit homepage %s", async (homepage) => {
    const directory = await createFixture();
    await mkdir(join(directory, "alpha", "folder.md"));
    await writeFile(join(directory, "alpha", "notes.txt"), "notes");
    const configPath = join(directory, "webdoc.config.yaml");
    await writeFile(configPath, `projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n    homepage: ${homepage}\n`);
    await expect(loadConfig(configPath)).rejects.toThrow(/homepage|markdown|outside|regular/i);
  });

  it.each([0, 65536])("rejects port %d", async (port) => {
    await expect(
      loadFixtureConfig(
        `server:\n  port: ${port}\nprojects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n`,
      ),
    ).rejects.toThrow(/port/i);
  });

  it("rejects empty project lists", async () => {
    await expect(loadFixtureConfig("projects: []\n")).rejects.toThrow(/project/i);
  });

  it.each(["markdownBytes", "assetBytes"])("rejects non-positive %s", async (limit) => {
    await expect(
      loadFixtureConfig(
        `limits:\n  ${limit}: 0\nprojects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n`,
      ),
    ).rejects.toThrow(new RegExp(limit, "i"));
  });

  it("rejects an empty homepage", async () => {
    await expect(
      loadFixtureConfig(
        "projects:\n  - id: alpha\n    title: Alpha\n    path: ./alpha\n    homepage: ''\n",
      ),
    ).rejects.toThrow(/homepage/i);
  });
});

describe("server scripts", () => {
  it.each(["dev", "start"])("delegates the %s listener to the YAML-aware launcher", async (script) => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts[script]).toBe(`tsx scripts/webdoc-server.ts ${script}`);
  });
});
