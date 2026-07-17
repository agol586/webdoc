import { errorResponse, json, unavailableResponse } from "../../../../http/responses";
import { getServerContext } from "../../../../server/context";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, routeContext: RouteContext): Promise<Response> {
  try {
    const { projectId } = await routeContext.params;
    const { config, repository } = await getServerContext();
    const project = config.projects.find((candidate) => candidate.id === projectId);
    if (!project) return json({ error: "Project not found" }, { status: 404 });
    if (!(await repository.isAvailable(project))) return unavailableResponse();
    return json({ project: { id: project.id, title: project.title }, tree: await repository.getTree(project) });
  } catch (error) {
    return errorResponse(error);
  }
}
