import { redirect } from "next/navigation";

import { getServerContext } from "../server/context";

export const dynamic = "force-dynamic";

function encodedRoute(projectId: string, path?: string | null): string {
  const root = `/p/${encodeURIComponent(projectId)}`;
  return path ? `${root}/${path.split("/").map(encodeURIComponent).join("/")}` : root;
}

export default async function Home() {
  const { config, repository } = await getServerContext();
  const project = config.projects[0];
  if (!(await repository.isAvailable(project))) redirect(encodedRoute(project.id));
  const tree = await repository.getTree(project);
  const homepage = await repository.chooseHomepage(project, tree);
  redirect(encodedRoute(project.id, homepage));
}
