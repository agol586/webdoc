import { errorResponse, json } from "../../../http/responses";
import { getServerContext } from "../../../server/context";

export async function GET(): Promise<Response> {
  try {
    const { config, repository } = await getServerContext();
    const projects = await Promise.all(
      config.projects.map(async ({ id, title, ...project }) => ({
        id,
        title,
        available: await repository.isAvailable({ id, title, ...project }),
      })),
    );
    return json({ projects });
  } catch (error) {
    return errorResponse(error);
  }
}
