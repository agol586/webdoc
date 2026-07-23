import { z } from "zod";

const PROJECT_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const ProjectSchema = z.object({
  id: z.string().regex(PROJECT_ID, "Project id must contain lowercase letters, numbers, or hyphens"),
  title: z.string().min(1, "Project title must not be empty"),
  path: z.string().min(1, "Project path must not be empty"),
  homepage: z.string().min(1, "Project homepage must not be empty").optional(),
  exclude: z.array(z.string().min(1, "Exclude pattern must not be empty")).optional(),
});

export const RawConfigSchema = z.object({
  server: z
    .object({
      host: z.string().min(1, "Server host must not be empty").optional(),
      port: z.number().int().min(1, "Server port must be at least 1").max(65535, "Server port must be at most 65535").optional(),
    })
    .optional(),
  limits: z
    .object({
      markdownBytes: z.number().int().positive("markdownBytes must be positive").optional(),
      assetBytes: z.number().int().positive("assetBytes must be positive").optional(),
    })
    .optional(),
  projects: z
    .array(ProjectSchema)
    .min(1, "At least one project is required")
    .superRefine((projects, context) => {
      const seen = new Set<string>();
      for (const [index, project] of projects.entries()) {
        if (seen.has(project.id)) {
          context.addIssue({
            code: "custom",
            message: "Project ids must be unique",
            path: [index, "id"],
          });
        }
        seen.add(project.id);
      }
    }),
});

export type RawConfig = z.infer<typeof RawConfigSchema>;
