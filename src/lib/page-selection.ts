import type { TreeNode } from "../repository/types";

function encoded(prefix: string, projectId: string, path: string): string {
  return `/${prefix}/${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
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

function directoryHomepage(node: Extract<TreeNode, { kind: "directory" }>): string | null {
  for (const candidate of ["readme.md", "index.md"]) {
    const match = node.children.find((child) => child.kind === "markdown" && child.name.toLowerCase() === candidate);
    if (match) return match.path;
  }
  return firstMarkdown(node.children);
}

export function nodeDestination(projectId: string, node: TreeNode): { kind: "redirect"; href: string } | { kind: "render" } {
  if (node.kind === "attachment") return { kind: "redirect", href: encoded("api/assets", projectId, node.path) };
  if (node.kind === "directory") {
    const homepage = directoryHomepage(node);
    return homepage ? { kind: "redirect", href: encoded("p", projectId, homepage) } : { kind: "render" };
  }
  return { kind: "render" };
}

export function selectActivePath(
  imagePath: string | null | undefined,
  documentPath: string | null | undefined,
): string | undefined {
  return (imagePath ?? documentPath) || undefined;
}
