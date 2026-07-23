import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { RawConfigSchema } from "./schema";
import { isExcludedTarget } from "../lib/exclusions";
import { resolveInsideRoot, validateHomepagePath } from "../lib/path-policy";

export type ProjectConfig = {
  id: string;
  title: string;
  root: string;
  homepage?: string;
  exclude?: string[];
};

export type DocShareConfig = {
  server: { host: string; port: number };
  limits: { markdownBytes: number; assetBytes: number };
  projects: ProjectConfig[];
};

export async function loadConfig(configPath: string): Promise<DocShareConfig> {
  const source = await readFile(configPath, "utf8");
  const parsed = RawConfigSchema.parse(parseYaml(source));
  const base = dirname(resolve(configPath));
  const projects = await Promise.all(
    parsed.projects.map(async (project) => {
      const root = await realpath(resolve(base, project.path));
      const exclude = project.exclude ?? [];
      if (project.homepage !== undefined) {
        await validateHomepagePath(root, project.homepage);
        const homepage = await resolveInsideRoot(root, project.homepage);
        if (isExcludedTarget(root, exclude, project.homepage, homepage)) {
          throw new Error("Homepage validation failed: homepage is excluded");
        }
      }
      return { id: project.id, title: project.title, root, homepage: project.homepage, exclude };
    }),
  );

  return {
    server: {
      host: parsed.server?.host ?? "127.0.0.1",
      port: parsed.server?.port ?? 3030,
    },
    limits: {
      markdownBytes: parsed.limits?.markdownBytes ?? 5 * 1024 * 1024,
      assetBytes: parsed.limits?.assetBytes ?? 25 * 1024 * 1024,
    },
    projects,
  };
}
