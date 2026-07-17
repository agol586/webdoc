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

function safeFilename(path: string): string {
  return basename(path).replace(/["\\\r\n]/g, "_") || "download";
}

export async function GET(_request: Request, routeContext: RouteContext): Promise<Response> {
  try {
    const { projectId, path: segments } = await routeContext.params;
    const { config, repository } = await getServerContext();
    const project = config.projects.find((candidate) => candidate.id === projectId);
    if (!project) return json({ error: "Project not found" }, { status: 404 });
    if (!(await repository.isAvailable(project))) return unavailableResponse();
    const path = segments.join("/");
    const asset = await repository.stream(project, path, config.limits.assetBytes);
    const contentType = inlineTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Length": String(asset.size),
      "X-Content-Type-Options": "nosniff",
      ETag: `\"${asset.size.toString(16)}-${Math.trunc(asset.mtimeMs).toString(16)}\"`,
      "Last-Modified": new Date(asset.mtimeMs).toUTCString(),
    });
    if (contentType === "image/svg+xml") {
      headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox; script-src 'none'");
    }
    if (contentType === "application/octet-stream") {
      headers.set("Content-Disposition", `attachment; filename=\"${safeFilename(path)}\"`);
    }
    return new Response(asset.body, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
