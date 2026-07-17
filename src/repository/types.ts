export type TreeNode =
  | { kind: "directory"; name: string; path: string; children: TreeNode[] }
  | { kind: "markdown" | "image" | "attachment"; name: string; path: string; size: number };
