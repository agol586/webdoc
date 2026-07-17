import { MermaidBlocks } from "./mermaid-blocks";

export function DocumentView({ html, path, title }: { html: string; path: string; title?: string }) {
  return (
    <article aria-label={title ?? path}>
      <MermaidBlocks html={html} path={path} />
    </article>
  );
}
