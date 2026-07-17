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
  const tree = await repository.getTree(project);
  const homepage = await repository.chooseHomepage(project, tree) ?? firstMarkdown(tree);
  redirect(encodedRoute(project.id, homepage));
}

function firstMarkdown(nodes: Awaited<ReturnType<import("../repository/repository").DocumentRepository["getTree"]>>): string | null {
  for (const node of nodes) {
    if (node.kind === "markdown") return node.path;
    if (node.kind === "directory") {
      const nested = firstMarkdown(node.children);
      if (nested) return nested;
    }
  }
  return null;
}
