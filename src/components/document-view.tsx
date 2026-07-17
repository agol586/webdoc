import { MermaidBlocks } from "./mermaid-blocks";

export function DocumentView({ html, path, title }: { html: string; path: string; title?: string }) {
  return (
    <article aria-label={title ?? path}>
      <MermaidBlocks html={html} path={path} />
    </article>
  );
}

export function ImageView({ projectId, path }: { projectId: string; path: string }) {
  const source = `/api/assets/${encodeURIComponent(projectId)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const name = path.split("/").at(-1) ?? path;
  // The bounded asset endpoint serves original files (including SVG); optimization would alter that contract.
  // eslint-disable-next-line @next/next/no-img-element
  return <figure className="image-preview"><img src={source} alt={name} /></figure>;
}
