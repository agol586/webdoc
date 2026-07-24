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

export interface RewriteRemoteUrlsOptions {
  baseUrl: string;
}

export class MarkdownUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownUrlError";
  }
}

function decodedForSchemeCheck(url: string): string {
  let decoded = url;
  for (let pass = 0; pass < 8; pass += 1) {
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

function assertRemainingEncodingIsNonStructural(pathname: string, url: string): void {
  let probe = pathname;
  for (let pass = 0; /%[\da-f]{2}/i.test(probe); pass += 1) {
    if (pass === 8) throw new MarkdownUrlError(`Excessively encoded relative URL: ${url}`);
    let decoded: string;
    try {
      decoded = decodeURIComponent(probe);
    } catch {
      throw new MarkdownUrlError(`Invalid encoded relative URL: ${url}`);
    }

    const introducedSeparator =
      decoded.split("/").length > probe.split("/").length ||
      decoded.split("\\").length > probe.split("\\").length;
    const hasDotSegment = decoded.split(/[\\/]/).some((segment) => segment === "." || segment === "..");
    if (introducedSeparator || hasDotSegment || decoded.includes("\0")) {
      throw new MarkdownUrlError(`Unsafe structural encoding rejected: ${url}`);
    }
    probe = decoded;
  }
}

function normalizeContainedPath(documentPath: string, url: string): string {
  const { pathname, suffix } = splitSuffix(url);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new MarkdownUrlError(`Invalid encoded relative URL: ${url}`);
  }
  assertRemainingEncodingIsNonStructural(decodedPath, url);
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
    throw new MarkdownUrlError(`Relative URL escapes the project document root: ${url}`);
  }

  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  return encoded + suffix;
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function validateExternalUrl(node: MarkdownNode): string | undefined {
  if (!node.url) return undefined;
  const scheme = externalScheme(node.url);
  if (!scheme) return undefined;
  if (
    !node.url.startsWith("//") &&
    node.url.slice(0, scheme.length + 1).toLowerCase() !== `${scheme}:`
  ) {
    throw new MarkdownUrlError(`Encoded URL scheme rejected: ${scheme}`);
  }
  const allowed =
    scheme === "http" || scheme === "https" || (node.type === "link" && scheme === "mailto");
  if (!allowed) throw new MarkdownUrlError(`Unsafe URL scheme rejected: ${scheme}`);
  return scheme;
}

function markExternalLink(node: MarkdownNode): void {
  if (node.type !== "link") return;
  node.data ??= {};
  node.data.hProperties = {
    ...node.data.hProperties,
    target: "_blank",
    rel: "noopener noreferrer",
  };
}

export function rewriteRelativeUrls(options: RewriteRelativeUrlsOptions) {
  return (tree: MarkdownNode): void => {
    walk(tree, (node) => {
      if ((node.type !== "link" && node.type !== "image") || !node.url) return;

      const scheme = validateExternalUrl(node);
      if (scheme) {
        markExternalLink(node);
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

export function rewriteRemoteUrls(options: RewriteRemoteUrlsOptions) {
  return (tree: MarkdownNode): void => {
    walk(tree, (node) => {
      if ((node.type !== "link" && node.type !== "image") || !node.url) return;
      const scheme = validateExternalUrl(node);
      if (node.url.startsWith("#")) return;

      try {
        node.url = new URL(node.url, options.baseUrl).href;
      } catch {
        throw new MarkdownUrlError(`Invalid remote document URL: ${node.url}`);
      }
      if (scheme || node.url.startsWith("http://") || node.url.startsWith("https://")) {
        markExternalLink(node);
      }
    });
  };
}
