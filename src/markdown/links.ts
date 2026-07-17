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

function decodedForSchemeCheck(url: string): string {
  let decoded = url;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.replace(/[\u0000-\u0020\u007f]+/g, "");
}

function externalScheme(url: string): string | undefined {
  if (url.startsWith("//")) return "https";
  return /^([a-z][a-z\d+.-]*):/i.exec(decodedForSchemeCheck(url))?.[1].toLowerCase();
}

function splitSuffix(url: string): { pathname: string; suffix: string } {
  const suffixIndex = url.search(/[?#]/);
  return suffixIndex < 0
    ? { pathname: url, suffix: "" }
    : { pathname: url.slice(0, suffixIndex), suffix: url.slice(suffixIndex) };
}

function normalizeContainedPath(documentPath: string, url: string): string {
  const { pathname, suffix } = splitSuffix(url);
  let decodedPath = pathname;
  for (let pass = 0; /%[\da-f]{2}/i.test(decodedPath); pass += 1) {
    if (pass === 8) throw new Error(`Excessively encoded relative URL: ${url}`);
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      throw new Error(`Invalid encoded relative URL: ${url}`);
    }
  }
  decodedPath = decodedPath.replaceAll("\\", "/");

  const base = posix.dirname(documentPath.replaceAll("\\", "/"));
  const normalized = posix.normalize(
    decodedPath === "" ? documentPath.replaceAll("\\", "/") : posix.join(base, decodedPath),
  );
  if (
    posix.isAbsolute(decodedPath) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Relative URL escapes the project document root: ${url}`);
  }

  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  return encoded + suffix;
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

export function rewriteRelativeUrls(options: RewriteRelativeUrlsOptions) {
  return (tree: MarkdownNode): void => {
    walk(tree, (node) => {
      if ((node.type !== "link" && node.type !== "image") || !node.url) return;

      const scheme = externalScheme(node.url);
      if (scheme) {
        const allowed =
          scheme === "http" || scheme === "https" || (node.type === "link" && scheme === "mailto");
        if (!allowed) throw new Error(`Unsafe URL scheme rejected: ${scheme}`);
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
