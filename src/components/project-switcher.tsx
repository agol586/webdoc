"use client";

import { useRouter } from "next/navigation";

export type ProjectOption = { id: string; title: string; homepage: string | null };

function documentHref(project: ProjectOption): string {
  const root = `/p/${encodeURIComponent(project.id)}`;
  return project.homepage
    ? `${root}/${project.homepage.split("/").map(encodeURIComponent).join("/")}`
    : root;
}

export function ProjectSwitcher({ projects, activeId }: { projects: ProjectOption[]; activeId: string }) {
  const router = useRouter();

  return (
    <label className="project-switcher">
      <span>Project</span>
      <select
        value={activeId}
        onChange={(event) => {
          const project = projects.find(({ id }) => id === event.target.value);
          if (project) router.push(documentHref(project));
        }}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.title}</option>
        ))}
      </select>
    </label>
  );
}
