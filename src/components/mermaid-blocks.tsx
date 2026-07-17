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

function normalizeMermaidSource(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim().length === 0) lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) lines.pop();
  const indent = lines
    .filter((line) => line.trim().length > 0)
    .reduce((minIndent, line) => {
      const match = line.match(/^[\t ]*/)?.[0].length ?? 0;
      return minIndent === undefined ? match : Math.min(minIndent, match);
    }, undefined as number | undefined);

  if (!indent) return lines.join("\n");

  return lines
    .map((line) => (line.trim().length === 0 ? "" : line.slice(indent)))
    .join("\n");
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
      const source = normalizeMermaidSource(node.dataset.mermaidSource ?? node.textContent ?? "");
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
