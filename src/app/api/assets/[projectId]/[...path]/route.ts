import { basename, extname } from "node:path";

import { errorResponse, json, unavailableResponse } from "../../../../../http/responses";
import { getServerContext } from "../../../../../server/context";

type RouteContext = { params: Promise<{ projectId: string; path: string[] }> };

const inlineTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(path: string): string {
  const original = basename(path) || "download";
  const fallback = original.replace(/[^\x20-\x7e]|["\\\x7f]/g, "") || "download";
  const extended = original === fallback ? "" : `; filename*=UTF-8''${encodeRFC5987(original)}`;
  return `attachment; filename=\"${fallback}\"${extended}`;
}

export async function GET(_request: Request, routeContext: RouteContext): Promise<Response> {
  try {
    const { projectId, path: segments } = await routeContext.params;
    const { config, repository } = await getServerContext();
    const project = config.projects.find((candidate) => candidate.id === projectId);
    if (!project) return json({ error: "Project not found" }, { status: 404 });
    if (!(await repository.isAvailable(project))) return unavailableResponse();
    const path = segments.join("/");
    const contentType = inlineTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
    const headers = new Headers({
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (contentType === "image/svg+xml") {
      headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox; script-src 'none'");
    }
    if (contentType === "application/octet-stream") {
      headers.set("Content-Disposition", contentDisposition(path));
    }
    const repositoryPath = segments.map(encodeURIComponent).join("/");
    const asset = await repository.stream(project, repositoryPath, config.limits.assetBytes);
    try {
      headers.set("Content-Length", String(asset.size));
      headers.set("ETag", `\"${asset.size.toString(16)}-${Math.trunc(asset.mtimeMs).toString(16)}\"`);
      headers.set("Last-Modified", new Date(asset.mtimeMs).toUTCString());
      return new Response(asset.body, { headers });
    } catch (error) {
      asset.close();
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
