import { matchesGlob, relative, sep } from "node:path";

export type ExclusionMatchOptions = { directory?: boolean };

function portablePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function matchesCandidate(
  patterns: readonly string[],
  path: string,
  directory: boolean,
): boolean {
  return patterns.some(
    (pattern) => matchesGlob(path, pattern) || (directory && matchesGlob(`${path}/`, pattern)),
  );
}

export function isExcludedPath(
  patterns: readonly string[],
  relativePath: string,
  options: ExclusionMatchOptions = {},
): boolean {
  if (patterns.length === 0) return false;
  const path = portablePath(relativePath);
  if (matchesCandidate(patterns, path, options.directory === true)) return true;

  const segments = path.split("/");
  for (let length = segments.length - 1; length > 0; length--) {
    if (matchesCandidate(patterns, segments.slice(0, length).join("/"), true)) return true;
  }
  return false;
}

export function isExcludedTarget(
  root: string,
  patterns: readonly string[],
  requestedPath: string,
  canonicalPath: string,
  options: ExclusionMatchOptions = {},
): boolean {
  if (patterns.length === 0) return false;
  return (
    isExcludedPath(patterns, decodeURIComponent(requestedPath), options) ||
    isExcludedPath(patterns, relative(root, canonicalPath), options)
  );
}
