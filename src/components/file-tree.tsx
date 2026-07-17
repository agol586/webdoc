import type { TreeNode } from "../repository/types";

function href(projectId: string, path: string): string {
  return `/p/${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function assetHref(projectId: string, path: string): string {
  return `/api/assets/${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function TreeItems({ projectId, nodes, activePath }: { projectId: string; nodes: TreeNode[]; activePath?: string }) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={`${node.kind}:${node.path}`}>
          {node.kind === "directory" ? (
            <details open={activePath === node.path || activePath?.startsWith(`${node.path}/`)}>
              <summary><a href={href(projectId, node.path)}>{node.name}</a></summary>
              <TreeItems projectId={projectId} nodes={node.children} activePath={activePath} />
            </details>
          ) : (
            <a href={node.kind === "attachment" ? assetHref(projectId, node.path) : href(projectId, node.path)} aria-current={activePath === node.path ? "page" : undefined}>
              {node.name}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export function FileTree(props: { projectId: string; nodes: TreeNode[]; activePath?: string }) {
  return <TreeItems {...props} />;
}
