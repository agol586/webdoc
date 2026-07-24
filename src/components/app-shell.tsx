"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { TreeNode } from "../repository/types";
import { FileTree } from "./file-tree";
import { ProjectSwitcher, type ProjectOption } from "./project-switcher";
import { RemoteLinkForm } from "./remote-link-form";
import { LiveRefresh } from "./live-refresh";

export function AppShell({ projects, activeId, nodes, activePath, children }: {
  projects: ProjectOption[];
  activeId: string;
  nodes: TreeNode[];
  activePath?: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (drawerOpen) drawerRef.current?.querySelector<HTMLElement>("a, summary, button")?.focus();
  }, [drawerOpen]);

  function closeDrawer() {
    setDrawerOpen(false);
    toggleRef.current?.focus();
  }

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), summary, select, [tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const tree = <FileTree projectId={activeId} nodes={nodes} activePath={activePath} />;
  return (
    <div className="app-shell">
      <LiveRefresh activeId={activeId} activePath={activePath} />
      <header className="app-header">
        <button ref={toggleRef} className="tree-toggle" aria-expanded={drawerOpen} aria-controls="mobile-tree" onClick={() => setDrawerOpen(true)}>
          Browse documents
        </button>
        <ProjectSwitcher projects={projects} activeId={activeId} />
        <RemoteLinkForm />
      </header>
      <div className="reader-layout">
        <nav className="document-tree desktop-tree" aria-label="Document tree">{tree}</nav>
        {drawerOpen && <div className="drawer-backdrop" onMouseDown={closeDrawer}>
          <nav ref={drawerRef} id="mobile-tree" className="document-tree mobile-tree" aria-label="Document tree" onKeyDown={handleDrawerKeyDown} onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={closeDrawer}>Close</button>
            {tree}
          </nav>
        </div>}
        <main className="content-pane">{children}</main>
      </div>
    </div>
  );
}
