import { PathPolicyError } from "../lib/path-policy";
import { FileTooLargeError } from "../repository/repository";

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof PathPolicyError) return json({ error: "Invalid path" }, { status: 400 });
  if (error instanceof FileTooLargeError) return json({ error: "File too large" }, { status: 413 });

  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return json({ error: "Not found" }, { status: 404 });
  if (code === "EACCES" || code === "EPERM" || code === "EISDIR") {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  console.error("API request failed", error);
  return json({ error: "Internal server error" }, { status: 500 });
}

export function unavailableResponse(): Response {
  return json({ error: "Project unavailable" }, { status: 503 });
}
