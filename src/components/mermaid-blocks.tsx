"use client";

import mermaid from "mermaid";
import { useEffect, useRef } from "react";

import { panViewBox, parseViewBox, zoomViewBox, type ViewBox } from "./mermaid-viewport";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;
const MIN_VIEW_BOX_SCALE = 0.25;
const MAX_VIEW_BOX_SCALE = 4;

type IconName = "zoom-in" | "zoom-out" | "reset" | "pan";

const ICON_PATHS: Record<IconName, string[]> = {
  "zoom-in": ["M11 11l4 4", "M10 7H4", "M7 4v6", "M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"],
  "zoom-out": ["M11 11l4 4", "M10 7H4", "M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z"],
  reset: ["M3 6V2m0 0h4M3 2l3 3", "M3.5 10a6 6 0 1 0 .2-6.3"],
  pan: ["M6 8V4a1 1 0 0 1 2 0v4", "M8 7V3a1 1 0 0 1 2 0v5", "M10 7V4a1 1 0 0 1 2 0v5", "M12 8V6a1 1 0 0 1 2 0v4c0 3-2 5-5 5H8c-2 0-3-1-4-3L2 9a1 1 0 0 1 2-1l2 2"],
};

function createIcon(name: IconName): SVGSVGElement {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  for (const pathData of ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  }
  return icon;
}

function createControl(label: string, icon: IconName): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mermaid-control";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(createIcon(icon));
  return button;
}

function formatViewBox(viewBox: ViewBox): string {
  return [viewBox.x, viewBox.y, viewBox.width, viewBox.height]
    .map((value) => String(Math.abs(value) < Number.EPSILON ? 0 : value))
    .join(" ");
}

function installDiagramControls(diagram: HTMLDivElement): () => void {
  const svg = diagram.querySelector<SVGSVGElement>("svg");
  if (!svg) return () => undefined;

  const originalViewBox = parseViewBox(svg);
  let currentViewBox = { ...originalViewBox };
  let panEnabled = false;
  let activePointer: { id: number; x: number; y: number } | undefined;

  const viewport = document.createElement("div");
  viewport.className = "mermaid-viewport";
  svg.replaceWith(viewport);
  viewport.append(svg);

  const toolbar = document.createElement("div");
  toolbar.className = "mermaid-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Diagram controls");

  const zoomIn = createControl("Zoom in", "zoom-in");
  const zoomOut = createControl("Zoom out", "zoom-out");
  const reset = createControl("Reset view", "reset");
  const pan = createControl("Pan diagram", "pan");
  pan.setAttribute("aria-pressed", "false");
  toolbar.append(zoomIn, zoomOut, reset, pan);
  diagram.prepend(toolbar);

  const updateViewBox = (next: ViewBox) => {
    currentViewBox = next;
    svg.setAttribute("viewBox", formatViewBox(next));
  };
  const zoom = (factor: number) => {
    const nextScale = (currentViewBox.width * factor) / originalViewBox.width;
    if (nextScale < MIN_VIEW_BOX_SCALE || nextScale > MAX_VIEW_BOX_SCALE) return;
    updateViewBox(zoomViewBox(currentViewBox, factor));
  };
  const onZoomIn = () => zoom(ZOOM_IN_FACTOR);
  const onZoomOut = () => zoom(ZOOM_OUT_FACTOR);
  const onReset = () => updateViewBox({ ...originalViewBox });
  const onPanToggle = () => {
    panEnabled = !panEnabled;
    pan.setAttribute("aria-pressed", String(panEnabled));
    viewport.classList.toggle("is-pan-enabled", panEnabled);
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (!panEnabled) return;
    event.preventDefault();
    activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.classList.add("is-dragging");
    viewport.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!activePointer || event.pointerId !== activePointer.id) return;
    const bounds = viewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    updateViewBox(panViewBox(
      currentViewBox,
      event.clientX - activePointer.x,
      event.clientY - activePointer.y,
      bounds.width,
      bounds.height,
    ));
    activePointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const finishPointer = (event: PointerEvent) => {
    if (!activePointer || event.pointerId !== activePointer.id) return;
    activePointer = undefined;
    viewport.classList.remove("is-dragging");
    viewport.releasePointerCapture?.(event.pointerId);
  };

  zoomIn.addEventListener("click", onZoomIn);
  zoomOut.addEventListener("click", onZoomOut);
  reset.addEventListener("click", onReset);
  pan.addEventListener("click", onPanToggle);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("pointermove", onPointerMove);
  viewport.addEventListener("pointerup", finishPointer);
  viewport.addEventListener("pointercancel", finishPointer);

  return () => {
    zoomIn.removeEventListener("click", onZoomIn);
    zoomOut.removeEventListener("click", onZoomOut);
    reset.removeEventListener("click", onReset);
    pan.removeEventListener("click", onPanToggle);
    viewport.removeEventListener("wheel", onWheel);
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("pointermove", onPointerMove);
    viewport.removeEventListener("pointerup", finishPointer);
    viewport.removeEventListener("pointercancel", finishPointer);
  };
}

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
    const cleanups: Array<() => void> = [];
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });

    const blocks = [...container.querySelectorAll<HTMLPreElement>("pre.mermaid")];
    for (const [index, node] of blocks.entries()) {
      const source = normalizeMermaidSource(node.dataset.mermaidSource ?? node.textContent ?? "");
      node.replaceChildren();
      const diagram = document.createElement("div");
      diagram.className = "mermaid-diagram";
      node.append(diagram);
      void mermaid.render(`mermaid-${stableHash(path)}-${index}`, source, diagram).then(
        ({ svg }) => {
          if (!cancelled) {
            diagram.innerHTML = svg;
            cleanups.push(installDiagramControls(diagram));
          }
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
    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [html, path]);

  return <div ref={containerRef} className="document-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
