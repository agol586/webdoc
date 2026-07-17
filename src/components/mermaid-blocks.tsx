"use client";

import mermaid from "mermaid";
import { useEffect, useRef } from "react";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function MermaidBlocks({ html, path }: { html: string; path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });

    const blocks = [...container.querySelectorAll<HTMLPreElement>("pre.mermaid")];
    for (const [index, node] of blocks.entries()) {
      const source = node.dataset.mermaidSource ?? node.textContent ?? "";
      node.replaceChildren();
      const diagram = document.createElement("div");
      diagram.className = "mermaid-diagram";
      node.append(diagram);
      void mermaid.render(`mermaid-${stableHash(path)}-${index}`, source).then(
        ({ svg }) => {
          if (!cancelled) diagram.innerHTML = svg;
        },
        () => {
          if (cancelled) return;
          diagram.remove();
          const message = document.createElement("p");
          message.className = "mermaid-error";
          message.textContent = "Diagram could not be rendered.";
          const fallback = document.createElement("code");
          fallback.textContent = source;
          node.append(message, fallback);
        },
      );
    }
    return () => { cancelled = true; };
  }, [html, path]);

  return <div ref={containerRef} className="document-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
