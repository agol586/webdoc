import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

export class PathPolicyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PathPolicyError";
  }
}

function decodeURIComponentOnce(requested: string): string {
  try {
    return decodeURIComponent(requested);
  } catch (error) {
    throw new PathPolicyError("invalid encoded path", { cause: error });
  }
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

export async function resolveInsideRoot(root: string, requested: string): Promise<string> {
  const decoded = decodeURIComponentOnce(requested);
  if (decoded.includes("\0") || isAbsolute(decoded) || /^[A-Za-z]:/.test(decoded)) {
    throw new PathPolicyError("absolute path rejected");
  }

  const lexical = resolve(root, decoded);
  if (!isContained(root, lexical)) {
    throw new PathPolicyError("path outside project root");
  }

  const canonical = await realpath(lexical);
  if (!isContained(root, canonical)) {
    throw new PathPolicyError("symlink target outside project root");
  }
  return canonical;
}

export async function validateHomepagePath(root: string, requested: string): Promise<void> {
  try {
    const canonical = await resolveInsideRoot(root, requested);
    const metadata = await stat(canonical);
    if (extname(canonical).toLowerCase() !== ".md" || !metadata.isFile()) {
      throw new PathPolicyError("must be an existing regular Markdown file inside the project root");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PathPolicyError(`Homepage validation failed: ${detail}`, { cause: error });
  }
}
