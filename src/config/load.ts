import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { RawConfigSchema } from "./schema";
import { validateHomepagePath } from "../lib/path-policy";

export type ProjectConfig = {
  id: string;
  title: string;
  root: string;
  homepage?: string;
};

export type WebDocConfig = {
  server: { host: string; port: number };
  limits: { markdownBytes: number; assetBytes: number };
  projects: ProjectConfig[];
};

export async function loadConfig(configPath: string): Promise<WebDocConfig> {
  const source = await readFile(configPath, "utf8");
  const parsed = RawConfigSchema.parse(parseYaml(source));
  const base = dirname(resolve(configPath));
  const projects = await Promise.all(
    parsed.projects.map(async (project) => {
      const root = await realpath(resolve(base, project.path));
      if (project.homepage !== undefined) await validateHomepagePath(root, project.homepage);
      return { id: project.id, title: project.title, root, homepage: project.homepage };
    }),
  );

  return {
    server: {
      host: parsed.server?.host ?? "127.0.0.1",
      port: parsed.server?.port ?? 3000,
    },
    limits: {
      markdownBytes: parsed.limits?.markdownBytes ?? 5 * 1024 * 1024,
      assetBytes: parsed.limits?.assetBytes ?? 25 * 1024 * 1024,
    },
    projects,
  };
}
