import { errorResponse, json, unavailableResponse } from "../../../../../http/responses";
import { renderMarkdown } from "../../../../../markdown/render";
import { getServerContext } from "../../../../../server/context";

type RouteContext = { params: Promise<{ projectId: string; path: string[] }> };

export async function GET(_request: Request, routeContext: RouteContext): Promise<Response> {
  try {
    const { projectId, path: segments } = await routeContext.params;
    const { config, repository } = await getServerContext();
    const project = config.projects.find((candidate) => candidate.id === projectId);
    if (!project) return json({ error: "Project not found" }, { status: 404 });
    if (!(await repository.isAvailable(project))) return unavailableResponse();
    const path = segments.join("/");
    const source = await repository.read(project, path, config.limits.markdownBytes);
    const rendered = await renderMarkdown({ projectId, documentPath: path, source: source.toString("utf8") });
    return json({ path, ...rendered });
  } catch (error) {
    return errorResponse(error);
  }
}
