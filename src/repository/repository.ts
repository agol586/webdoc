import { opendir, readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import type { ProjectConfig } from "../config/load";
import { resolveInsideRoot } from "../lib/path-policy";
import type { TreeNode } from "./types";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

export class FileTooLargeError extends Error {
  constructor(path: string, size: number, limit: number) {
    super(`${path} is ${size} bytes, exceeding the ${limit} byte limit`);
    this.name = "FileTooLargeError";
  }
}

export class InvalidHomepageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHomepageError";
  }
}

function joinRelative(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function fileKind(name: string): "markdown" | "image" | "attachment" {
  const extension = extname(name).toLowerCase();
  if (extension === ".md") return "markdown";
  if (imageExtensions.has(extension)) return "image";
  return "attachment";
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((left, right) => {
    const leftDirectory = left.kind === "directory";
    const rightDirectory = right.kind === "directory";
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
    return collator.compare(left.name, right.name);
  });
}

export class DocumentRepository {
  async getTree(project: ProjectConfig): Promise<TreeNode[]> {
    return this.scanDirectory(project.root, "", new Set([project.root]));
  }

  private async scanDirectory(root: string, relativeDirectory: string, visited: Set<string>): Promise<TreeNode[]> {
    const directory = relativeDirectory ? await resolveInsideRoot(root, relativeDirectory) : root;
    const handle = await opendir(directory);
    const nodes: TreeNode[] = [];

    for await (const entry of handle) {
      const relativePath = joinRelative(relativeDirectory, entry.name);
      let canonical: string;
      try {
        canonical = await resolveInsideRoot(root, relativePath);
      } catch {
        continue;
      }

      const metadata = await stat(canonical);
      if (metadata.isDirectory()) {
        if (visited.has(canonical)) continue;
        visited.add(canonical);
        const children = await this.scanDirectory(root, relativePath, visited);
        nodes.push({ kind: "directory", name: entry.name, path: relativePath, children });
      } else if (metadata.isFile()) {
        nodes.push({
          kind: fileKind(entry.name),
          name: entry.name,
          path: relativePath,
          size: metadata.size,
        });
      }
    }

    return sortNodes(nodes);
  }

  async chooseHomepage(project: ProjectConfig, _tree?: TreeNode[]): Promise<string | null> {
    if (project.homepage !== undefined) {
      await this.validateHomepage(project, project.homepage);
      return project.homepage;
    }

    for (const candidate of ["README.md", "index.md"]) {
      try {
        await this.validateHomepage(project, candidate);
        return candidate;
      } catch (error) {
        if (error instanceof InvalidHomepageError) throw error;
      }
    }
    return null;
  }

  private async validateHomepage(project: ProjectConfig, requested: string): Promise<void> {
    const canonical = await resolveInsideRoot(project.root, requested);
    const metadata = await stat(canonical);
    if (extname(canonical).toLowerCase() !== ".md" || !metadata.isFile()) {
      throw new InvalidHomepageError("Homepage must point to a Markdown file inside the project root");
    }
  }

  async read(project: ProjectConfig, path: string, limit: number): Promise<Buffer> {
    const canonical = await resolveInsideRoot(project.root, path);
    const metadata = await stat(canonical);
    if (metadata.size > limit) throw new FileTooLargeError(path, metadata.size, limit);
    return readFile(canonical);
  }
}
