import { notFound, redirect } from "next/navigation";

import { AppShell } from "../../../../components/app-shell";
import { DocumentView, ImageView } from "../../../../components/document-view";
import { ProjectUnavailable } from "../../../../components/project-unavailable";
import { renderMarkdown } from "../../../../markdown/render";
import { isMissingDocumentError } from "../../../../lib/page-errors";
import { nodeDestination, selectActivePath } from "../../../../lib/page-selection";
import type { TreeNode } from "../../../../repository/types";
import { getServerContext } from "../../../../server/context";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ projectId: string; path?: string[] }> };

function route(projectId: string, path: string): string {
  return `/p/${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function findNode(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.kind === "directory" && path.startsWith(`${node.path}/`)) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
}

function firstMarkdown(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "markdown") return node.path;
    if (node.kind === "directory") {
      const found = firstMarkdown(node.children);
      if (found) return found;
    }
  }
  return null;
}

export default async function ProjectPage({ params }: PageProps) {
  const { projectId, path: segments = [] } = await params;
  const { config, repository } = await getServerContext();
  const project = config.projects.find(({ id }) => id === projectId);
  if (!project) notFound();
  if (!(await repository.isAvailable(project))) return <ProjectUnavailable title={project.title} />;

  const tree = await repository.getTree(project);
  const projects = await Promise.all(config.projects.map(async ({ id, title, ...candidate }) => ({
    id,
    title,
    homepage: await repository.chooseHomepage({ id, title, ...candidate }).catch(() => null),
  })));
  let documentPath = segments.join("/");
  let imagePath: string | null = null;

  if (!documentPath) {
    documentPath = await repository.chooseHomepage(project, tree) ?? firstMarkdown(tree) ?? "";
    if (documentPath) redirect(route(projectId, documentPath));
  } else {
    const node = findNode(tree, documentPath);
    if (!node) notFound();
    const destination = nodeDestination(projectId, node);
    if (destination.kind === "redirect") redirect(destination.href);
    if (node.kind === "directory") {
      documentPath = "";
    } else if (node.kind === "image") {
      imagePath = documentPath;
      documentPath = "";
    }
  }

  let content = null;
  if (documentPath) {
    try {
      const repositoryPath = documentPath.split("/").map(encodeURIComponent).join("/");
      const source = await repository.read(project, repositoryPath, config.limits.markdownBytes);
      content = await renderMarkdown({ projectId, documentPath, source: source.toString("utf8") });
    } catch (error) {
      if (isMissingDocumentError(error)) notFound();
      throw error;
    }
  }

  return (
    <AppShell projects={projects} activeId={projectId} nodes={tree} activePath={selectActivePath(imagePath, documentPath)}>
      {imagePath ? <ImageView projectId={projectId} path={imagePath} /> : content ? <DocumentView {...content} path={documentPath} /> : (
        <section className="empty-state"><h1>{project.title}</h1><p>This project has no Markdown documents.</p></section>
      )}
    </AppShell>
  );
}
