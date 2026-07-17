import { posix } from "node:path";

type MarkdownNode = {
  type?: string;
  url?: string;
  children?: MarkdownNode[];
  data?: {
    hProperties?: Record<string, unknown>;
  };
};

export interface RewriteRelativeUrlsOptions {
  projectId: string;
  documentPath: string;
}

function isExternal(url: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);
}

function splitSuffix(url: string): { pathname: string; suffix: string } {
  const suffixIndex = url.search(/[?#]/);
  return suffixIndex < 0
    ? { pathname: url, suffix: "" }
    : { pathname: url.slice(0, suffixIndex), suffix: url.slice(suffixIndex) };
}

function normalizeContainedPath(documentPath: string, url: string): string {
  const { pathname, suffix } = splitSuffix(url);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname).replaceAll("\\", "/");
  } catch {
    throw new Error(`Invalid encoded relative URL: ${url}`);
  }

  const base = posix.dirname(documentPath.replaceAll("\\", "/"));
  const normalized = posix.normalize(posix.join(base, decodedPath));
  if (
    posix.isAbsolute(decodedPath) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Relative URL escapes the project document root: ${url}`);
  }

  return normalized + suffix;
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function rewriteRelativeUrls(options: RewriteRelativeUrlsOptions) {
  return (tree: MarkdownNode): void => {
    walk(tree, (node) => {
      if ((node.type !== "link" && node.type !== "image") || !node.url) return;

      if (isExternal(node.url)) {
        if (node.type === "link") {
          node.data ??= {};
          node.data.hProperties = {
            ...node.data.hProperties,
            target: "_blank",
            rel: "noopener noreferrer",
          };
        }
        return;
      }

      if (node.url.startsWith("#")) return;
      const rewritten = normalizeContainedPath(options.documentPath, node.url);
      const projectId = encodeURIComponent(options.projectId);
      node.url =
        node.type === "image"
          ? `/api/assets/${projectId}/${rewritten}`
          : `/p/${projectId}/${rewritten}`;
    });
  };
}
