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

  const dedented = (!indent ? lines : lines
    .map((line) => (line.trim().length === 0 ? "" : line.slice(indent)))
    ).join("\n");

  return normalizeSequenceDiagramParticipantAliases(
    normalizeSequenceDiagramParBlocks(dedented),
  );
}

function normalizeSequenceDiagramParticipantAliases(source: string): string {
  const lines = source.split("\n");
  const first = lines.find((line) => line.trim().length > 0)?.trimStart() ?? "";
  if (!first.startsWith("sequenceDiagram")) return source;

  const aliases = new Map<string, string>();
  for (const line of lines) {
    const declaration = line.match(/^(\s*(?:participant|actor)\s+)(\S+)(\s+as\s+.*)?$/);
    if (declaration?.[2].toLowerCase() === "loop") {
      aliases.set(declaration[2], `${declaration[2]}_participant`);
    }
  }

  return lines.map((line) => {
    const declaration = line.match(/^(\s*(?:participant|actor)\s+)(\S+)(\s+as\s+.*)?$/);
    if (declaration && aliases.has(declaration[2])) {
      return `${declaration[1]}${aliases.get(declaration[2])}${declaration[3] ?? ""}`;
    }

    let normalized = line;
    for (const [alias, replacement] of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      normalized = normalized
        .replace(new RegExp(`^(\\s*)${escaped}(?=\\s*[=-]+(?:>>?|x|\\)))`), `$1${replacement}`)
        .replace(new RegExp(`([=-]+(?:>>?|x|\\))\\s*)${escaped}(?=\\s*:)`), `$1${replacement}`);
    }
    return normalized;
  }).join("\n");
}

function normalizeSequenceDiagramParBlocks(source: string): string {
  const lines = source.split("\n");
  const first = lines.find((line) => line.trim().length > 0)?.trimStart() ?? "";
  if (!first.startsWith("sequenceDiagram")) return source;

  const output: string[] = [];
  const stack: Array<{ startIndex: number; hasAnd: boolean }> = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (/^par(?:\s|$)/.test(trimmed)) {
      stack.push({ startIndex: output.length, hasAnd: false });
      output.push(line);
      continue;
    }
    if (/^and(?:\s|$)/.test(trimmed) && stack.length > 0) {
      stack[stack.length - 1].hasAnd = true;
      output.push(line);
      continue;
    }
    if (/^end(?:\s|$)/.test(trimmed) && stack.length > 0) {
      const block = stack.pop()!;
      if (block.hasAnd) output.push(line);
      else output[block.startIndex] = "";
      continue;
    }
    output.push(line);
  }

  return output.filter((line) => line.trim().length > 0).join("\n");
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
