import { constants } from "node:fs";
import { access, open, opendir, stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

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

function notRegularFile(): NodeJS.ErrnoException {
  const error = new Error("Requested path is not a regular file") as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

const safeOpenFlags =
  constants.O_RDONLY |
  (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);
const READ_CHUNK_BYTES = 64 * 1024;

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  path: string,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= limit) {
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, total);
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
    if (total > limit) throw new FileTooLargeError(path, total, limit);
  }
  throw new FileTooLargeError(path, total, limit);
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
  async isAvailable(project: ProjectConfig): Promise<boolean> {
    try {
      await access(project.root);
      return (await stat(project.root)).isDirectory();
    } catch {
      return false;
    }
  }

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
      } catch {}
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
    if (!(await stat(canonical)).isFile()) throw notRegularFile();
    const handle = await open(canonical, safeOpenFlags);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw notRegularFile();
      if (metadata.size > limit) throw new FileTooLargeError(path, metadata.size, limit);
      return await readBounded(handle, path, limit);
    } finally {
      await handle.close();
    }
  }

  async stream(
    project: ProjectConfig,
    path: string,
    limit: number,
  ): Promise<{
    body: ReadableStream<Uint8Array>;
    size: number;
    mtimeMs: number;
    close: () => void;
  }> {
    const canonical = await resolveInsideRoot(project.root, path);
    if (!(await stat(canonical)).isFile()) throw notRegularFile();
    const handle = await open(canonical, safeOpenFlags);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw notRegularFile();
      if (metadata.size > limit) throw new FileTooLargeError(path, metadata.size, limit);
      if (metadata.size === 0) {
        await handle.close();
        const empty = Readable.from([]);
        return {
          body: Readable.toWeb(empty) as ReadableStream<Uint8Array>,
          size: 0,
          mtimeMs: metadata.mtimeMs,
          close: () => empty.destroy(),
        };
      }
      const stream = handle.createReadStream({ autoClose: true, end: metadata.size - 1 });
      return {
        body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        close: () => stream.destroy(),
      };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
}
