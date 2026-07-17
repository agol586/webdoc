"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { TreeNode } from "../repository/types";
import { FileTree } from "./file-tree";
import { ProjectSwitcher, type ProjectOption } from "./project-switcher";

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

  const tree = <FileTree projectId={activeId} nodes={nodes} activePath={activePath} />;
  return (
    <div className="app-shell">
      <header className="app-header">
        <button ref={toggleRef} className="tree-toggle" aria-expanded={drawerOpen} aria-controls="mobile-tree" onClick={() => setDrawerOpen(true)}>
          Browse documents
        </button>
        <ProjectSwitcher projects={projects} activeId={activeId} />
      </header>
      <div className="reader-layout">
        <nav className="document-tree desktop-tree" aria-label="Document tree">{tree}</nav>
        {drawerOpen && <div className="drawer-backdrop" onMouseDown={closeDrawer}>
          <nav ref={drawerRef} id="mobile-tree" className="document-tree mobile-tree" aria-label="Document tree" onMouseDown={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={closeDrawer}>Close</button>
            {tree}
          </nav>
        </div>}
        <main className="content-pane">{children}</main>
      </div>
    </div>
  );
}
